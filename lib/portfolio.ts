import { db } from './db';
import { D, money, AppError } from './money';
import { currentPrice } from './market';
import { syncMarket } from './trading';
import { feedStatus, validatedQuote } from './live/quotes';
import type { User } from './auth';
import type { Account, Order, Ledger } from './shared';
import type { StoredBalance } from './wallet';
export function account(userId: string): Account {
  syncMarket();
  return db()
    .transaction(() => {
      const user = db().prepare('SELECT * FROM users WHERE id=?').get(userId) as User | undefined;
      if (!user) throw new AppError('Please sign in.', 401);
      let equity = D(0),
        unrealized = D(0),
        complete = true;
      const balances = (
        db().prepare('SELECT * FROM balances WHERE user_id=?').all(userId) as StoredBalance[]
      ).map((b) => {
        const quantity = D(b.available).add(b.reserved);
        let price: string | null = b.asset === 'USDT' ? '1' : quantity.isZero() ? '0' : null;
        if (price === null) {
          try {
            price =
              user.market_mode === 'simulated'
                ? currentPrice(b.asset)
                : validatedQuote(b.asset, 'live').price;
          } catch {
            /* Preserve holdings; unavailable prices are not fabricated. */
          }
        }
        const value = price !== null ? quantity.mul(price) : null,
          pnl = value ? (b.asset === 'USDT' ? D(0) : value.sub(b.cost_basis)) : null;
        if (value && pnl) {
          equity = equity.add(value);
          unrealized = unrealized.add(pnl);
        } else complete = false;
        return {
          asset: b.asset,
          available: b.available,
          reserved: b.reserved,
          costBasis: b.cost_basis,
          value: value ? money(value) : null,
          averageCost: quantity.gt(0) ? money(D(b.cost_basis).div(quantity)) : '0',
          unrealized: pnl ? money(pnl) : null,
        };
      });
      if (complete)
        db()
          .prepare('INSERT OR REPLACE INTO equity_history VALUES(?,?,?,?,?)')
          .run(
            userId,
            user.epoch,
            user.market_mode,
            Math.floor(Date.now() / 60000) * 60,
            money(equity),
          );
      return {
        user: { id: user.id, name: user.name, email: user.email, created_at: user.created_at },
        balances,
        orders: db()
          .prepare('SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC')
          .all(userId) as Order[],
        ledger: db()
          .prepare('SELECT * FROM ledger WHERE user_id=? ORDER BY created_at DESC,rowid DESC')
          .all(userId) as Ledger[],
        equity: complete ? money(equity) : null,
        unrealized: complete ? money(unrealized) : null,
        realized: user.realized,
        netDeposits: user.net_deposits,
        marketMode: user.market_mode,
        openingFunds: user.opening_funds,
        valuationStatus:
          user.market_mode === 'simulated' ? 'SIMULATED' : complete ? feedStatus() : 'STALE',
        performance: db()
          .prepare(
            'SELECT time,equity FROM equity_history WHERE user_id=? AND epoch=? AND mode=? ORDER BY time',
          )
          .all(userId, user.epoch, user.market_mode) as Account['performance'],
      };
    })
    .immediate();
}
