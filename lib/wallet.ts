import { randomUUID } from 'node:crypto';
import { db } from './db';
import { D, money, AppError } from './money';
export type StoredBalance = {
  user_id: string;
  asset: string;
  available: string;
  reserved: string;
  cost_basis: string;
};
export function balance(userId: string, asset: string): StoredBalance {
  const found = db()
    .prepare('SELECT * FROM balances WHERE user_id=? AND asset=?')
    .get(userId, asset) as StoredBalance | undefined;
  if (!found) throw new AppError('Unknown account or asset.', 404);
  return found;
}
// Caller owns an immediate transaction. Every balance mutation gets an immutable ledger entry.
export function changeBalance(
  userId: string,
  asset: string,
  available: string,
  reserved: string,
  kind: string,
  orderId: string | null = null,
) {
  const b = balance(userId, asset);
  const a = D(b.available).add(available),
    r = D(b.reserved).add(reserved);
  if (a.lt(0) || r.lt(0)) throw new AppError('Insufficient available funds.');
  db()
    .prepare('UPDATE balances SET available=?,reserved=? WHERE user_id=? AND asset=?')
    .run(money(a), money(r), userId, asset);
  db()
    .prepare('INSERT INTO ledger VALUES(?,?,?,?,?,?,?,?)')
    .run(randomUUID(), userId, asset, money(available), money(reserved), kind, orderId, Date.now());
}
