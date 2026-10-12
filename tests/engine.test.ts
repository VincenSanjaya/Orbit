import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { unlinkSync } from 'node:fs';
import { db } from '../lib/db';
import { register, login, createSession, sessionUser, logout } from '../lib/auth';
import { D, feeFor } from '../lib/money';
import { ASSETS } from '../lib/shared';
import { adjustOpeningBalance } from '../scripts/set-account-balance';
import { instrument } from '../lib/live/quotes';
import { saveInstruments, saveTicker, saveCandle, saveBook } from '../lib/live/ingest';
import { balance, changeBalance } from '../lib/wallet';
import { submitOrder, cancelOrder, matchPending, faucet, resetAccount } from '../lib/trading';
import { initializeMarket, simulatedProvider, aggregateCandles } from '../lib/market';
import { account } from '../lib/portfolio';
import type { Ledger, Order } from '../lib/shared';
const run = promisify(execFile);
const user = async () => {
  const u = await register({
    name: 'Test Trader',
    email: `${randomUUID()}@orbit.test`,
    password: 'correct-horse-123',
  });
  // Engine fixtures fund explicitly; production registration remains zero.
  db()
    .transaction(() => {
      changeBalance(u.id, 'USDT', '10000', '0', 'TEST_FUNDING');
      db()
        .prepare(
          "UPDATE users SET net_deposits='10000',opening_funds='10000',market_mode='simulated' WHERE id=?",
        )
        .run(u.id);
    })
    .immediate();
  return u;
};
const order = (
  id: string,
  values: Partial<{
    side: 'BUY' | 'SELL';
    type: 'MARKET' | 'LIMIT';
    quantity: string;
    price: string;
    idempotencyKey: string;
  }> = {},
) =>
  submitOrder(id, {
    symbol: 'BTC',
    side: 'BUY',
    type: 'MARKET',
    quantity: '0.01',
    idempotencyKey: randomUUID(),
    ...values,
  });
const setPrice = (price: string) =>
  db()
    .prepare('UPDATE market_state SET price=?,last_tick=? WHERE symbol=?')
    .run(price, Date.now() + 86400000, 'BTC');
function reconcile(userId: string) {
  const ledger = db().prepare('SELECT * FROM ledger WHERE user_id=?').all(userId) as Ledger[];
  for (const asset of ['USDT', ...ASSETS.map((a) => a.symbol)]) {
    const entries = ledger.filter((l) => l.asset === asset),
      b = balance(userId, asset);
    expect(entries.reduce((n, l) => n.add(l.available_delta), D(0)).eq(b.available)).toBe(true);
    expect(entries.reduce((n, l) => n.add(l.reserved_delta), D(0)).eq(b.reserved)).toBe(true);
    expect(D(b.available).gte(0) && D(b.reserved).gte(0)).toBe(true);
  }
}
beforeAll(() => {
  for (const suffix of ['', '-wal', '-shm'])
    try {
      unlinkSync('./data/engine-test.sqlite' + suffix);
    } catch {
      /* The test database may not exist yet. */
    }
  initializeMarket();
  setPrice('50000');
});
afterAll(() => db().close());
describe('ORBIT server-authoritative engine', () => {
  it('uses decimal-safe configurable fee arithmetic', () => {
    expect(feeFor('0.01', '50000', '0.0015')).toBe('0.75');
    expect(feeFor('3', '0.1', '0.001')).toBe('0.0003');
    expect(feeFor('0.00001', '67432.81', '0.0015')).toBe('0.00101149');
  });
  it('registers hashed credentials, funds accounts, persists/revokes sessions', async () => {
    const u = await user(),
      stored = db().prepare('SELECT password_hash FROM users WHERE id=?').get(u.id) as {
        password_hash: string;
      };
    expect(stored.password_hash).not.toContain('correct-horse');
    expect((await login({ email: u.email, password: 'correct-horse-123' })).id).toBe(u.id);
    await expect(login({ email: u.email, password: 'incorrect-password' })).rejects.toThrow(
      'incorrect',
    );
    const session = createSession(u.id);
    expect(sessionUser(session.token)?.id).toBe(u.id);
    expect(sessionUser('forged-token')).toBeNull();
    logout(session.token);
    expect(sessionUser(session.token)).toBeNull();
    expect(balance(u.id, 'USDT').available).toBe('10000');
    reconcile(u.id);
  });
  it('market buy debits quote plus fee and credits full base; weighted cost includes fee', async () => {
    setPrice('50000');
    const u = await user(),
      o = order(u.id);
    expect(o.status).toBe('FILLED');
    expect(o.fee).toBe('0.75');
    expect(balance(u.id, 'USDT').available).toBe('9499.25');
    expect(balance(u.id, 'BTC').available).toBe('0.01');
    const p = account(u.id);
    expect(p.balances.find((b) => b.asset === 'BTC')?.averageCost).toBe('50075');
    expect(p.unrealized).toBe('-0.75');
    reconcile(u.id);
  });
  it('market sell accounts for taker fee, realized P&L, and remaining basis', async () => {
    setPrice('50000');
    const u = await user();
    order(u.id);
    setPrice('60000');
    const o = order(u.id, { side: 'SELL', quantity: '0.005' });
    expect(o.fee).toBe('0.45');
    expect(balance(u.id, 'USDT').available).toBe('9798.8');
    expect(balance(u.id, 'BTC').available).toBe('0.005');
    const p = account(u.id);
    expect(p.realized).toBe('49.175');
    expect(p.unrealized).toBe('49.625');
    expect(p.equity).toBe('10098.8');
    reconcile(u.id);
  });
  it('rejects insufficient funds and preserves rejection record without balance changes', async () => {
    setPrice('50000');
    const u = await user(),
      o = order(u.id, { quantity: '0.5' });
    expect(o.status).toBe('REJECTED');
    expect(o.reason).toContain('Insufficient');
    expect(balance(u.id, 'USDT').available).toBe('10000');
    reconcile(u.id);
  });
  it('rejects invalid quantity, precision, price, minimum notional and unknown markets', async () => {
    setPrice('50000');
    const u = await user();
    expect(() => order(u.id, { quantity: '-1' })).toThrow();
    expect(() => order(u.id, { quantity: '0.000001' })).toThrow('multiple');
    expect(() => order(u.id, { type: 'LIMIT', price: '40000.001' })).toThrow('multiple');
    expect(order(u.id, { quantity: '0.00001' }).status).toBe('REJECTED');
    expect(() =>
      submitOrder(u.id, {
        symbol: 'FAKE',
        side: 'BUY',
        type: 'MARKET',
        quantity: '1',
        idempotencyKey: randomUUID(),
      }),
    ).toThrow();
    reconcile(u.id);
  });
  it('reserves limit buys and cancellation releases quote including reserved fee', async () => {
    setPrice('50000');
    const u = await user(),
      o = order(u.id, { type: 'LIMIT', price: '40000' });
    expect(o.status).toBe('OPEN');
    expect(balance(u.id, 'USDT').available).toBe('9599.6');
    expect(balance(u.id, 'USDT').reserved).toBe('400.4');
    expect(cancelOrder(u.id, o.id).status).toBe('CANCELED');
    expect(balance(u.id, 'USDT').available).toBe('10000');
    expect(balance(u.id, 'USDT').reserved).toBe('0');
    setPrice('30000');
    db().transaction(matchPending).immediate();
    expect((db().prepare('SELECT * FROM orders WHERE id=?').get(o.id) as Order).status).toBe(
      'CANCELED',
    );
    reconcile(u.id);
  });
  it('fills crossed limit buy once at better price and releases unused reserves', async () => {
    setPrice('50000');
    const u = await user(),
      o = order(u.id, { type: 'LIMIT', price: '40000' });
    setPrice('39000');
    db().transaction(matchPending).immediate();
    db().transaction(matchPending).immediate();
    const filled = db().prepare('SELECT * FROM orders WHERE id=?').get(o.id) as Order;
    expect(filled.status).toBe('FILLED');
    expect(filled.execution_price).toBe('39000');
    expect(filled.fee).toBe('0.39');
    expect(balance(u.id, 'USDT').available).toBe('9609.61');
    expect(balance(u.id, 'USDT').reserved).toBe('0');
    expect(balance(u.id, 'BTC').available).toBe('0.01');
    expect(
      (
        db().prepare('SELECT count(*) AS n FROM executions WHERE order_id=?').get(o.id) as {
          n: number;
        }
      ).n,
    ).toBe(1);
    reconcile(u.id);
  });
  it('reserves, cancels, and fills limit sells with coherent cost basis', async () => {
    setPrice('50000');
    const u = await user();
    order(u.id);
    const a = order(u.id, { side: 'SELL', type: 'LIMIT', price: '60000', quantity: '0.005' });
    expect(balance(u.id, 'BTC').reserved).toBe('0.005');
    cancelOrder(u.id, a.id);
    expect(balance(u.id, 'BTC').available).toBe('0.01');
    const b = order(u.id, { side: 'SELL', type: 'LIMIT', price: '60000', quantity: '0.005' });
    setPrice('61000');
    db().transaction(matchPending).immediate();
    expect((db().prepare('SELECT * FROM orders WHERE id=?').get(b.id) as Order).fee).toBe('0.305');
    expect(account(u.id).realized).toBe('54.32');
    expect(balance(u.id, 'BTC').reserved).toBe('0');
    reconcile(u.id);
  });
  it('idempotency replays the same order but rejects key reuse with changed content', async () => {
    setPrice('50000');
    const u = await user(),
      key = randomUUID(),
      a = order(u.id, { idempotencyKey: key }),
      b = order(u.id, { idempotencyKey: key });
    expect(a.id).toBe(b.id);
    expect(() => order(u.id, { idempotencyKey: key, quantity: '0.02' })).toThrow('different order');
    expect(balance(u.id, 'BTC').available).toBe('0.01');
    reconcile(u.id);
  });
  it('prevents cross-account ownership access and cancellation', async () => {
    setPrice('50000');
    const a = await user(),
      b = await user(),
      o = order(a.id, { type: 'LIMIT', price: '40000' });
    expect(() => cancelOrder(b.id, o.id)).toThrow('not found');
    expect(account(b.id).orders).toHaveLength(0);
    cancelOrder(a.id, o.id);
    reconcile(a.id);
    reconcile(b.id);
  });
  it('keeps ledger and execution rows immutable', async () => {
    setPrice('50000');
    const u = await user(),
      o = order(u.id);
    expect(() =>
      db().prepare("UPDATE ledger SET available_delta='1' WHERE user_id=?").run(u.id),
    ).toThrow('immutable');
    expect(() => db().prepare('DELETE FROM ledger WHERE user_id=?').run(u.id)).toThrow('immutable');
    expect(() => db().prepare('DELETE FROM executions WHERE order_id=?').run(o.id)).toThrow(
      'immutable',
    );
    reconcile(u.id);
  });
  it('funding and reset preserve history, cancel pending orders and reconcile all balances', async () => {
    setPrice('50000');
    const u = await user();
    order(u.id);
    order(u.id, { type: 'LIMIT', price: '40000' });
    faucet(u.id);
    expect(balance(u.id, 'USDT').available).toBe('10098.85');
    expect(() => faucet(u.id)).toThrow('once per minute');
    resetAccount(u.id);
    expect(balance(u.id, 'USDT').available).toBe('10000');
    expect(balance(u.id, 'USDT').reserved).toBe('0');
    expect(balance(u.id, 'BTC').available).toBe('0');
    expect(balance(u.id, 'BTC').cost_basis).toBe('0');
    expect(account(u.id).orders).toHaveLength(2);
    expect(account(u.id).realized).toBe('0');
    expect(account(u.id).netDeposits).toBe('10000');
    reconcile(u.id);
  });
  it('concurrent independent SQLite writers cannot double-spend', async () => {
    setPrice('50000');
    const u = await user();
    const outcomes = await Promise.all(
      [randomUUID(), randomUUID()].map((key) =>
        run(
          process.execPath,
          ['--import', 'tsx', 'scripts/concurrency-probe.ts', u.id, key, '0.15'],
          { env: process.env },
        ),
      ),
    );
    expect(outcomes.map((o) => JSON.parse(o.stdout).status).sort()).toEqual(['FILLED', 'REJECTED']);
    expect(balance(u.id, 'BTC').available).toBe('0.15');
    reconcile(u.id);
  });
  it('concurrent duplicate requests produce exactly one execution', async () => {
    setPrice('50000');
    const u = await user(),
      key = randomUUID();
    const outcomes = await Promise.all(
      [1, 2].map(() =>
        run(
          process.execPath,
          ['--import', 'tsx', 'scripts/concurrency-probe.ts', u.id, key, '0.01'],
          { env: process.env },
        ),
      ),
    );
    expect(JSON.parse(outcomes[0].stdout).id).toBe(JSON.parse(outcomes[1].stdout).id);
    expect(account(u.id).orders).toHaveLength(1);
    expect(balance(u.id, 'BTC').available).toBe('0.01');
    reconcile(u.id);
  });
  it('synthetic OHLC bars aggregate coherently at every supported timeframe', async () => {
    const snapshot = await simulatedProvider.snapshot('ETH', '15m');
    expect(snapshot.source).toBe('simulated');
    expect(snapshot.markets).toHaveLength(16);
    for (const timeframe of ['1m', '5m', '15m', '1h', '4h', '1d'] as const) {
      const candles = aggregateCandles('ETH', timeframe);
      expect(candles.length).toBeGreaterThan(0);
      for (const c of candles) {
        expect(D(c.high).gte(c.open) && D(c.high).gte(c.close)).toBe(true);
        expect(D(c.low).lte(c.open) && D(c.low).lte(c.close)).toBe(true);
        expect(D(c.volume).gte(0)).toBe(true);
      }
    }
  });
  it('fractional basis removal reconciles equity exactly at eight-decimal accounting precision', async () => {
    setPrice('50000.02');
    const u = await user();
    order(u.id, { quantity: '0.001' });
    order(u.id, { side: 'SELL', quantity: '0.0005' });
    const p = account(u.id);
    expect(D(p.netDeposits).add(p.realized).add(p.unrealized!).eq(p.equity!)).toBe(true);
    reconcile(u.id);
  });
  it('new registrations start at zero and cash-only adjustment is immutable and idempotent', async () => {
    const u = await register({
      name: 'Zero Account',
      email: randomUUID() + '@orbit.test',
      password: 'zero-account-123',
    });
    expect(balance(u.id, 'USDT').available).toBe('0');
    expect(account(u.id).equity).toBe('0');
    expect(adjustOpeningBalance(u.email, '349', 'grant:' + u.id).applied).toBe(true);
    expect(adjustOpeningBalance(u.email, '349', 'grant:' + u.id).applied).toBe(false);
    expect(account(u.id).equity).toBe('349');
    expect(account(u.id).openingFunds).toBe('349');
    resetAccount(u.id);
    expect(account(u.id).equity).toBe('349');
    reconcile(u.id);
  });
  it('HYPE live paper buy/sell uses verified fresh server quotes, fees and slippage', async () => {
    const u = await user();
    db().prepare("UPDATE users SET market_mode='live' WHERE id=?").run(u.id);
    liveFixture('HYPE', '40');
    const buy = submitOrder(u.id, {
      symbol: 'HYPE',
      mode: 'live',
      side: 'BUY',
      type: 'MARKET',
      quantity: '1',
      idempotencyKey: randomUUID(),
    });
    expect(buy.execution_price).toBe('40.01');
    expect(buy.snapshot_price).toBe('40');
    expect(buy.fee).toBe('0.060015');
    expect(balance(u.id, 'HYPE').available).toBe('1');
    expect(balance(u.id, 'USDT').available).toBe('9959.929985');
    liveFixture('HYPE', '45');
    const sell = submitOrder(u.id, {
      symbol: 'HYPE',
      mode: 'live',
      side: 'SELL',
      type: 'MARKET',
      quantity: '0.5',
      idempotencyKey: randomUUID(),
    });
    expect(sell.execution_price).toBe('44.99');
    expect(sell.fee).toBe('0.0337425');
    expect(account(u.id).realized).toBe('2.42625');
    reconcile(u.id);
  });
  it('live limit reserves, pauses on disconnect/stale quotes, fills once on fresh crossing', async () => {
    const u = await user();
    db().prepare("UPDATE users SET market_mode='live' WHERE id=?").run(u.id);
    liveFixture('HYPE', '40');
    const limit = submitOrder(u.id, {
      symbol: 'HYPE',
      mode: 'live',
      side: 'BUY',
      type: 'LIMIT',
      price: '35',
      quantity: '1',
      idempotencyKey: randomUUID(),
    });
    expect(limit.status).toBe('OPEN');
    expect(balance(u.id, 'USDT').reserved).toBe('35.035');
    liveFixture('HYPE', '34');
    db().prepare("UPDATE feed_state SET status='RECONNECTING' WHERE mode='live'").run();
    db()
      .transaction(() => matchPending('live'))
      .immediate();
    expect(balance(u.id, 'HYPE').available).toBe('0');
    db().prepare("UPDATE feed_state SET status='LIVE' WHERE mode='live'").run();
    db()
      .prepare('UPDATE live_quotes SET event_time=?,received_at=? WHERE symbol=?')
      .run(Date.now() - 60000, Date.now() - 60000, 'HYPE');
    db()
      .transaction(() => matchPending('live'))
      .immediate();
    expect(balance(u.id, 'HYPE').available).toBe('0');
    liveFixture('HYPE', '34');
    db()
      .transaction(() => matchPending('live'))
      .immediate();
    db()
      .transaction(() => matchPending('live'))
      .immediate();
    const filled = db().prepare('SELECT * FROM orders WHERE id=?').get(limit.id) as Order;
    expect(filled.status).toBe('FILLED');
    expect(filled.execution_price).toBe('34.01');
    expect(balance(u.id, 'USDT').reserved).toBe('0');
    expect(
      (
        db().prepare('SELECT count(*) AS n FROM executions WHERE order_id=?').get(limit.id) as {
          n: number;
        }
      ).n,
    ).toBe(1);
    reconcile(u.id);
  });
  it('invalid, halted, future and stale live quotes never fill orders; held valuations remain unavailable', async () => {
    const u = await user();
    db().prepare("UPDATE users SET market_mode='live' WHERE id=?").run(u.id);
    liveFixture('HYPE', '40');
    const input = {
      symbol: 'HYPE',
      mode: 'live',
      side: 'BUY',
      type: 'MARKET',
      quantity: '1',
      idempotencyKey: randomUUID(),
    };
    expect(
      saveTicker({
        s: 'HYPEUSDT',
        E: Date.now(),
        c: 'NaN',
        P: '0',
        h: '40',
        l: '40',
        q: '10',
        o: '40',
      }),
    ).toBe(false);
    db()
      .prepare('UPDATE live_quotes SET event_time=? WHERE symbol=?')
      .run(Date.now() + 60000, 'HYPE');
    expect(() => submitOrder(u.id, input)).toThrow('stale');
    liveFixture('HYPE', '40');
    submitOrder(u.id, input);
    db()
      .prepare('UPDATE live_quotes SET event_time=? WHERE symbol=?')
      .run(Date.now() - 60000, 'HYPE');
    expect(account(u.id).equity).toBeNull();
    expect(account(u.id).balances.find((b) => b.asset === 'HYPE')?.available).toBe('1');
    expect(() => submitOrder(u.id, { ...input, idempotencyKey: randomUUID() })).toThrow('stale');
    const rules = instrument('HYPE', 'live');
    db()
      .prepare('UPDATE instruments SET rules=? WHERE symbol=?')
      .run(JSON.stringify({ ...rules, status: 'HALT' }), 'HYPE');
    expect(() => submitOrder(u.id, { ...input, idempotencyKey: randomUUID() })).toThrow('active');
    reconcile(u.id);
  });
  it('orders retain their origin mode across account switches and canceled live limits never fill', async () => {
    setPrice('50000');
    const u = await user(),
      sim = order(u.id, { type: 'LIMIT', price: '40000' });
    db().prepare("UPDATE users SET market_mode='live' WHERE id=?").run(u.id);
    liveFixture('BTC', '30000');
    db()
      .transaction(() => matchPending('live'))
      .immediate();
    expect((db().prepare('SELECT * FROM orders WHERE id=?').get(sim.id) as Order).status).toBe(
      'OPEN',
    );
    liveFixture('HYPE', '40');
    const live = submitOrder(u.id, {
      symbol: 'HYPE',
      mode: 'live',
      type: 'LIMIT',
      side: 'BUY',
      quantity: '1',
      price: '35',
      idempotencyKey: randomUUID(),
    });
    cancelOrder(u.id, live.id);
    liveFixture('HYPE', '30');
    db()
      .transaction(() => matchPending('live'))
      .immediate();
    expect(balance(u.id, 'HYPE').available).toBe('0');
    expect(() => order(u.id)).toThrow('mode changed');
    cancelOrder(u.id, sim.id);
    reconcile(u.id);
  });
  it('historical live bootstrap never overwrites newer candle updates; stale depth sequence is ignored', () => {
    const time = Math.floor(Date.now() / 60000) * 60,
      c = { time, open: '40', high: '42', low: '39', close: '41', volume: '10' };
    expect(saveCandle('HYPE', '1m', c, Date.now())).toBe(true);
    saveCandle('HYPE', '1m', { ...c, close: '40' }, Date.now() + 1000, true);
    expect(
      (
        db()
          .prepare(
            "SELECT close FROM live_candles WHERE symbol='HYPE' AND interval='1m' AND time=?",
          )
          .get(time) as { close: string }
      ).close,
    ).toBe('41');
    expect(saveCandle('HYPE', '1m', { ...c, high: '39' }, Date.now() + 2000)).toBe(false);
    saveBook('HYPE', { lastUpdateId: 100, bids: [['40', '1']], asks: [['41', '1']] });
    saveBook('HYPE', { lastUpdateId: 99, bids: [['20', '1']], asks: [['21', '1']] });
    expect(
      (
        db().prepare("SELECT last_update_id FROM live_books WHERE symbol='HYPE'").get() as {
          last_update_id: number;
        }
      ).last_update_id,
    ).toBe(100);
  });
});

function liveFixture(symbol: string, price: string) {
  const now = Date.now();
  db()
    .prepare(
      "UPDATE feed_state SET status='LIVE',lease_until=?,updated_at=?,error=NULL WHERE mode='live'",
    )
    .run(now + 60000, now);
  db().prepare('DELETE FROM live_quotes WHERE symbol=?').run(symbol);
  const asset = ASSETS.find((a) => a.symbol === symbol)!;
  saveInstruments(
    ASSETS.map((a) => ({
      symbol: a.symbol + 'USDT',
      baseAsset: a.symbol,
      quoteAsset: 'USDT',
      status: 'TRADING',
      isSpotTradingAllowed: true,
      filters: [
        { filterType: 'PRICE_FILTER', tickSize: a.tick, minPrice: a.tick, maxPrice: '1000000' },
        { filterType: 'LOT_SIZE', minQty: a.lot, maxQty: '10000000000', stepSize: a.lot },
        { filterType: 'NOTIONAL', minNotional: '5', maxNotional: '1000000000' },
      ],
    })),
  );
  saveTicker({
    s: asset.symbol + 'USDT',
    E: now,
    c: price,
    P: '0',
    h: price,
    l: price,
    q: '1000',
    o: price,
  });
}
