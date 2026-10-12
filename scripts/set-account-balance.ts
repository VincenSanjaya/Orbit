import { db } from '../lib/db';
import { D, money, AppError } from '../lib/money';
import { balance, changeBalance } from '../lib/wallet';
import { cancelOrder } from '../lib/trading';
// Operator-only local command. No public funding/admin endpoint exists.
export function adjustOpeningBalance(email: string, amount: string, actionId: string) {
  if (!D(amount).isFinite() || D(amount).lt(0)) throw new AppError('Invalid balance.');
  return db()
    .transaction(() => {
      const user = db()
        .prepare('SELECT id,net_deposits FROM users WHERE lower(email)=?')
        .get(email.toLowerCase()) as { id: string; net_deposits: string } | undefined;
      if (!user) throw new AppError('Account not found.', 404);
      if (db().prepare('SELECT id FROM operator_actions WHERE id=?').get(actionId))
        return { applied: false, userId: user.id };
      const crypto = db()
        .prepare("SELECT available,reserved FROM balances WHERE user_id=? AND asset<>'USDT'")
        .all(user.id) as { available: string; reserved: string }[];
      if (crypto.some((b) => D(b.available).add(b.reserved).gt(0)))
        throw new AppError(
          'This adjustment only supports cash-only accounts; existing crypto holdings will not be changed.',
        );
      for (const o of db()
        .prepare("SELECT id FROM orders WHERE user_id=? AND status='OPEN'")
        .all(user.id) as { id: string }[])
        cancelOrder(user.id, o.id);
      const delta = D(amount).sub(balance(user.id, 'USDT').available);
      changeBalance(user.id, 'USDT', money(delta), '0', 'ACCOUNT_ADJUSTMENT');
      db()
        .prepare(
          "UPDATE users SET net_deposits=?,opening_funds=?,market_mode='live',epoch=epoch+1 WHERE id=?",
        )
        .run(money(D(user.net_deposits).add(delta)), money(amount), user.id);
      db()
        .prepare('INSERT INTO operator_actions VALUES(?,?,?,?)')
        .run(actionId, user.id, money(amount), Date.now());
      return { applied: true, userId: user.id, balance: money(amount) };
    })
    .immediate();
}
if (process.argv[1]?.endsWith('set-account-balance.ts')) {
  const [email, amount, actionId] = process.argv.slice(2);
  if (!email || !amount || !actionId)
    throw new Error('Usage: set-account-balance.ts email amount unique-action-id');
  console.log(adjustOpeningBalance(email, amount, actionId));
}
