import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from './db';
import { D, money, feeFor, MAKER, TAKER, AppError } from './money';
import { ASSETS, type Order, type MarketMode, type InstrumentRules } from './shared';
import { balance, changeBalance } from './wallet';
import { initializeMarket, tickMarket } from './market';
import { instrument, validatedQuote } from './live/quotes';
import { SLIPPAGE_BPS } from './live/config';
const decimal = z
  .string()
  .max(32)
  .regex(/^\d+(\.\d+)?$/, 'Enter a positive decimal value.')
  .refine(
    (v) => D(v).isFinite() && D(v).gt(0) && D(v).lte('1000000000000'),
    'Enter a positive value below one trillion.',
  );
const inputSchema = z.object({
  symbol: z.string().refine((v) => ASSETS.some((a) => a.symbol === v), 'Unsupported market.'),
  mode: z.enum(['live', 'simulated']).default('simulated'),
  side: z.enum(['BUY', 'SELL']),
  type: z.enum(['MARKET', 'LIMIT']),
  quantity: decimal,
  price: decimal.optional(),
  idempotencyKey: z.string().uuid(),
});
function getOrder(id: string) {
  return db().prepare('SELECT * FROM orders WHERE id=?').get(id) as Order;
}
// All-or-nothing settlement, protected by the same SQLite write lock as the price tick.
function fill(order: Order, price: string, quote: { price: string; eventTime: number }) {
  if (order.status !== 'OPEN') return;
  const notional = D(money(D(order.quantity).mul(price))),
    fee = feeFor(order.quantity, price, order.fee_rate);
  const reserve = D(order.reserved);
  const result = db()
    .prepare(
      "UPDATE orders SET status='FILLED',filled_quantity=quantity,execution_price=?,fee=?,reserved='0',updated_at=?,snapshot_price=?,quote_time=?,slippage_bps=? WHERE id=? AND status='OPEN'",
    )
    .run(
      price,
      fee,
      Date.now(),
      quote.price,
      quote.eventTime,
      order.mode === 'live' ? SLIPPAGE_BPS : '0',
      order.id,
    );
  if (result.changes !== 1) return;
  let realized = D(0);
  const base = balance(order.user_id, order.symbol);
  if (order.side === 'BUY') {
    const debit = notional.add(fee);
    changeBalance(
      order.user_id,
      'USDT',
      money(reserve.sub(debit)),
      money(reserve.neg()),
      'BUY_SETTLEMENT',
      order.id,
    );
    changeBalance(order.user_id, order.symbol, order.quantity, '0', 'BUY_SETTLEMENT', order.id);
    db()
      .prepare('UPDATE balances SET cost_basis=? WHERE user_id=? AND asset=?')
      .run(money(D(base.cost_basis).add(debit)), order.user_id, order.symbol);
  } else {
    const held = D(base.available).add(base.reserved);
    const removedCost = D(money(D(base.cost_basis).mul(order.quantity).div(held)));
    changeBalance(
      order.user_id,
      order.symbol,
      money(reserve.sub(order.quantity)),
      money(reserve.neg()),
      'SELL_SETTLEMENT',
      order.id,
    );
    changeBalance(
      order.user_id,
      'USDT',
      money(notional.sub(fee)),
      '0',
      'SELL_SETTLEMENT',
      order.id,
    );
    realized = notional.sub(fee).sub(removedCost);
    db()
      .prepare('UPDATE balances SET cost_basis=? WHERE user_id=? AND asset=?')
      .run(money(D(base.cost_basis).sub(removedCost)), order.user_id, order.symbol);
    const user = db().prepare('SELECT realized FROM users WHERE id=?').get(order.user_id) as {
      realized: string;
    };
    db()
      .prepare('UPDATE users SET realized=? WHERE id=?')
      .run(money(D(user.realized).add(realized)), order.user_id);
  }
  db()
    .prepare('INSERT INTO executions VALUES(?,?,?,?,?,?,?,?,?)')
    .run(
      randomUUID(),
      order.id,
      order.user_id,
      price,
      order.quantity,
      fee,
      'USDT',
      money(realized),
      Date.now(),
    );
}
export function executionPrice(
  price: string,
  side: 'BUY' | 'SELL',
  mode: MarketMode,
  rules: InstrumentRules,
  limit?: string | null,
) {
  const bps = mode === 'live' ? D(SLIPPAGE_BPS) : D(0);
  if (!bps.isFinite() || bps.lt(0) || bps.gt(100))
    throw new AppError('Paper slippage must be 0–100 basis points.', 503);
  const shifted = D(price).mul(D(1).add(bps.div(10000).mul(side === 'BUY' ? 1 : -1)));
  const stepped =
    side === 'BUY'
      ? shifted.div(rules.tickSize).ceil().mul(rules.tickSize)
      : shifted.div(rules.tickSize).floor().mul(rules.tickSize);
  return limit
    ? (side === 'BUY'
        ? stepped.lt(limit)
          ? stepped
          : D(limit)
        : stepped.gt(limit)
          ? stepped
          : D(limit)
      ).toFixed()
    : stepped.toFixed();
}
export function matchPending(mode?: MarketMode) {
  const orders = db()
    .prepare("SELECT * FROM orders WHERE status='OPEN' AND type='LIMIT' ORDER BY created_at,id")
    .all() as Order[];
  for (const order of orders) {
    if (mode && order.mode !== mode) continue;
    let quote, rules;
    try {
      quote = validatedQuote(order.symbol, order.mode);
      rules = instrument(order.symbol, order.mode);
    } catch {
      /* Disconnected, stale, halted or delisted markets never fill. */ continue;
    }
    if (
      order.side === 'BUY'
        ? D(quote.price).lte(order.limit_price!)
        : D(quote.price).gte(order.limit_price!)
    )
      fill(
        order,
        executionPrice(quote.price, order.side, order.mode, rules, order.limit_price),
        quote,
      );
  }
}
export function syncMarket() {
  initializeMarket();
  db()
    .transaction(() => {
      tickMarket();
      matchPending('simulated');
    })
    .immediate();
}
export function submitOrder(userId: string, input: unknown) {
  const parsed = inputSchema.parse(input);
  initializeMarket();
  const requestHash = createHash('sha256')
    .update(
      JSON.stringify({
        symbol: parsed.symbol,
        side: parsed.side,
        type: parsed.type,
        mode: parsed.mode,
        quantity: D(parsed.quantity).toFixed(),
        price: parsed.type === 'LIMIT' ? (parsed.price ? D(parsed.price).toFixed() : null) : null,
      }),
    )
    .digest('hex');
  return db()
    .transaction(() => {
      const existing = db()
        .prepare('SELECT * FROM orders WHERE user_id=? AND idempotency_key=?')
        .get(userId, parsed.idempotencyKey) as Order | undefined;
      if (existing) {
        if (existing.request_hash !== requestHash)
          throw new AppError('This request key was already used for a different order.', 409);
        return existing;
      }
      const user = db().prepare('SELECT market_mode FROM users WHERE id=?').get(userId) as
        { market_mode: MarketMode } | undefined;
      if (!user) throw new AppError('Please sign in.', 401);
      if (user.market_mode !== parsed.mode)
        throw new AppError(
          'Account market mode changed. Refresh and confirm your order again.',
          409,
        );
      if (parsed.mode === 'simulated') tickMarket();
      const rules = instrument(parsed.symbol, parsed.mode);
      const qty = D(parsed.quantity),
        step = rules.stepSize;
      if (!qty.mod(step).isZero())
        throw new AppError(`Quantity must be a multiple of ${step} ${parsed.symbol}.`);
      if (qty.lt(rules.minQty) || qty.gt(rules.maxQty))
        throw new AppError('Quantity is outside the instrument limits.');
      if (parsed.type === 'MARKET') {
        if (
          (D(rules.marketMinQty).gt(0) && qty.lt(rules.marketMinQty)) ||
          (D(rules.marketMaxQty).gt(0) && qty.gt(rules.marketMaxQty)) ||
          (D(rules.marketStepSize).gt(0) && !qty.mod(rules.marketStepSize).isZero())
        )
          throw new AppError('Quantity is outside Binance market-lot filters.');
      }
      if (
        parsed.type === 'LIMIT' &&
        (!parsed.price ||
          !D(parsed.price).mod(rules.tickSize).isZero() ||
          D(parsed.price).lt(rules.minPrice) ||
          (D(rules.maxPrice).gt(0) && D(parsed.price).gt(rules.maxPrice)))
      )
        throw new AppError(
          `Limit price must be a multiple of ${rules.tickSize} USDT and within the instrument price limits.`,
        );
      const quote = validatedQuote(parsed.symbol, parsed.mode);
      matchPending(parsed.mode);
      const price =
        parsed.type === 'LIMIT'
          ? parsed.price!
          : executionPrice(quote.price, parsed.side, parsed.mode, rules);
      const notional = D(money(qty.mul(price))),
        rate = parsed.type === 'LIMIT' ? MAKER : TAKER;
      const required =
        parsed.side === 'BUY'
          ? money(notional.add(feeFor(parsed.quantity, price, rate)))
          : money(qty);
      const available = balance(userId, parsed.side === 'BUY' ? 'USDT' : parsed.symbol).available;
      const reason = notional.lt(rules.minNotional)
        ? `Minimum order value is ${D(rules.minNotional).toFixed()} USDT.`
        : D(rules.maxNotional).gt(0) && notional.gt(rules.maxNotional)
          ? 'Order exceeds the maximum notional value.'
          : D(available).lt(required)
            ? 'Insufficient available funds.'
            : null;
      const id = randomUUID(),
        now = Date.now();
      db()
        .prepare(
          'INSERT INTO orders(id,user_id,symbol,side,type,quantity,limit_price,status,fee_rate,reserved,created_at,updated_at,reason,idempotency_key,request_hash,mode,slippage_bps) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        )
        .run(
          id,
          userId,
          parsed.symbol,
          parsed.side,
          parsed.type,
          money(qty),
          parsed.type === 'LIMIT' ? price : null,
          reason ? 'REJECTED' : 'OPEN',
          rate,
          reason ? '0' : parsed.type === 'LIMIT' ? required : '0',
          now,
          now,
          reason,
          parsed.idempotencyKey,
          requestHash,
          parsed.mode,
          parsed.mode === 'live' ? SLIPPAGE_BPS : '0',
        );
      if (reason) return getOrder(id);
      if (parsed.type === 'LIMIT') {
        changeBalance(
          userId,
          parsed.side === 'BUY' ? 'USDT' : parsed.symbol,
          money(D(required).neg()),
          required,
          'RESERVE',
          id,
        );
        matchPending(parsed.mode);
      } else fill(getOrder(id), price, quote);
      return getOrder(id);
    })
    .immediate();
}
export function setMarketMode(userId: string, mode: MarketMode) {
  if (!['live', 'simulated'].includes(mode)) throw new AppError('Unsupported market mode.');
  db()
    .transaction(() => {
      db()
        .prepare('UPDATE users SET market_mode=?,epoch=epoch+1 WHERE id=? AND market_mode<>?')
        .run(mode, userId, mode);
    })
    .immediate();
}
export function cancelOrder(userId: string, id: string) {
  return db()
    .transaction(() => {
      const order = db()
        .prepare('SELECT * FROM orders WHERE id=? AND user_id=?')
        .get(id, userId) as Order | undefined;
      if (!order) throw new AppError('Order not found.', 404);
      if (order.status === 'CANCELED') return order;
      if (order.status !== 'OPEN') throw new AppError('Only open orders can be canceled.', 409);
      db()
        .prepare(
          "UPDATE orders SET status='CANCELED',reserved='0',updated_at=? WHERE id=? AND status='OPEN'",
        )
        .run(Date.now(), id);
      changeBalance(
        userId,
        order.side === 'BUY' ? 'USDT' : order.symbol,
        order.reserved,
        money(D(order.reserved).neg()),
        'RELEASE',
        id,
      );
      return getOrder(id);
    })
    .immediate();
}
export function faucet(userId: string) {
  return db()
    .transaction(() => {
      const recent = db()
        .prepare("SELECT id FROM ledger WHERE user_id=? AND kind='FAUCET' AND created_at>?")
        .get(userId, Date.now() - 60000);
      if (recent) throw new AppError('The demo faucet is available once per minute.', 429);
      changeBalance(userId, 'USDT', '1000', '0', 'FAUCET');
      const user = db().prepare('SELECT net_deposits FROM users WHERE id=?').get(userId) as {
        net_deposits: string;
      };
      db()
        .prepare('UPDATE users SET net_deposits=? WHERE id=?')
        .run(money(D(user.net_deposits).add(1000)), userId);
    })
    .immediate();
}
export function resetAccount(userId: string) {
  return db()
    .transaction(() => {
      for (const order of db()
        .prepare("SELECT id FROM orders WHERE user_id=? AND status='OPEN'")
        .all(userId) as { id: string }[])
        cancelOrder(userId, order.id);
      for (const asset of ['USDT', ...ASSETS.map((a) => a.symbol)]) {
        const b = balance(userId, asset);
        changeBalance(
          userId,
          asset,
          money(D(b.available).neg()),
          money(D(b.reserved).neg()),
          'RESET_CLEAR',
        );
        db()
          .prepare("UPDATE balances SET cost_basis='0' WHERE user_id=? AND asset=?")
          .run(userId, asset);
      }
      const user = db().prepare('SELECT opening_funds FROM users WHERE id=?').get(userId) as {
        opening_funds: string;
      };
      changeBalance(userId, 'USDT', user.opening_funds, '0', 'RESET_FUNDING');
      db()
        .prepare(
          "UPDATE users SET realized='0',net_deposits=opening_funds,epoch=epoch+1 WHERE id=?",
        )
        .run(userId);
    })
    .immediate();
}
