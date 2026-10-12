import { z } from 'zod';
import { db } from '../db';
import { ASSETS, TIMEFRAMES, getAsset, type InstrumentRules, type Candle } from '../shared';
import { D } from '../money';
const decimal = z
  .string()
  .max(40)
  .regex(/^\d+(\.\d+)?$/)
  .refine((v) => D(v).isFinite() && D(v).gte(0));
const positive = decimal.refine((v) => D(v).gt(0));
const timestamp = z.number().int().positive();
export type ExchangeSymbol = {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  status: string;
  isSpotTradingAllowed: boolean;
  filters: Record<string, string | number | boolean | undefined>[];
};
export function saveInstruments(symbols: ExchangeSymbol[], now = Date.now()) {
  const entries = ASSETS.map((asset) => {
    const item = symbols.find(
      (s) =>
        s.symbol === asset.symbol + 'USDT' &&
        s.baseAsset === asset.symbol &&
        s.quoteAsset === 'USDT',
    );
    const filter = (name: string) => item?.filters.find((f) => f.filterType === name);
    const price = filter('PRICE_FILTER'),
      lot = filter('LOT_SIZE'),
      market = filter('MARKET_LOT_SIZE'),
      notional = filter('NOTIONAL') || filter('MIN_NOTIONAL');
    const text = (v: unknown, fallback = '0') =>
      typeof v === 'string' && decimal.safeParse(v).success ? v : fallback;
    const tick = text(price?.tickSize),
      step = text(lot?.stepSize);
    const valid =
      item?.status === 'TRADING' &&
      item.isSpotTradingAllowed === true &&
      D(tick).gt(0) &&
      D(step).gt(0);
    const rules: InstrumentRules = {
      symbol: asset.symbol,
      exchangeSymbol: asset.symbol + 'USDT',
      status: item?.status || 'NOT_LISTED',
      spotAllowed: !!valid,
      tickSize: tick,
      minPrice: text(price?.minPrice),
      maxPrice: text(price?.maxPrice),
      stepSize: step,
      minQty: text(lot?.minQty),
      maxQty: text(lot?.maxQty),
      marketMinQty: text(market?.minQty),
      marketMaxQty: text(market?.maxQty),
      marketStepSize: text(market?.stepSize),
      minNotional: text(notional?.minNotional, '5'),
      maxNotional: text(notional?.maxNotional),
      verifiedAt: now,
      source: 'binance',
    };
    return rules;
  });
  db()
    .transaction(() => {
      for (const r of entries)
        db()
          .prepare('INSERT OR REPLACE INTO instruments VALUES(?,?,?,?)')
          .run(r.symbol, r.status, JSON.stringify(r), now);
    })
    .immediate();
  return entries;
}
export function saveTicker(raw: unknown, kind: 'rest' | 'ws' = 'ws', receivedAt = Date.now()) {
  const schema =
    kind === 'ws'
      ? z.object({
          s: z.string(),
          E: timestamp,
          c: positive,
          P: z.string().max(40),
          h: positive,
          l: positive,
          q: decimal,
          o: positive,
        })
      : z.object({
          symbol: z.string(),
          closeTime: timestamp,
          lastPrice: positive,
          priceChangePercent: z.string().max(40),
          highPrice: positive,
          lowPrice: positive,
          quoteVolume: decimal,
          openPrice: positive,
        });
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return false;
  const v = parsed.data as Record<string, string | number>,
    symbol = String(v[kind === 'ws' ? 's' : 'symbol']).replace(/USDT$/, '');
  if (!getAsset(symbol)) return false;
  const eventTime = Number(v[kind === 'ws' ? 'E' : 'closeTime']);
  if (eventTime > receivedAt + 5000 || receivedAt - eventTime > 60000) return false;
  const price = String(v[kind === 'ws' ? 'c' : 'lastPrice']);
  const change = String(v[kind === 'ws' ? 'P' : 'priceChangePercent']);
  if (!D(change).isFinite()) return false;
  const stats = {
    change,
    high: String(v[kind === 'ws' ? 'h' : 'highPrice']),
    low: String(v[kind === 'ws' ? 'l' : 'lowPrice']),
    volume: String(v[kind === 'ws' ? 'q' : 'quoteVolume']),
  };
  const existing = db().prepare('SELECT event_time FROM live_quotes WHERE symbol=?').get(symbol) as
    { event_time: number } | undefined;
  // Older ticker stats can refresh stats, but cannot rewind a newer trade price.
  if (existing && existing.event_time > eventTime)
    db()
      .prepare('UPDATE live_quotes SET stats=? WHERE symbol=?')
      .run(JSON.stringify(stats), symbol);
  else
    db()
      .prepare('INSERT OR REPLACE INTO live_quotes VALUES(?,?,?,?,?)')
      .run(symbol, price, eventTime, receivedAt, JSON.stringify(stats));
  return true;
}
export function saveTrade(symbol: string, raw: unknown) {
  const parsed = z
    .object({
      t: z.number().int().nonnegative(),
      p: positive,
      q: positive,
      T: timestamp,
      E: timestamp.optional(),
      m: z.boolean(),
    })
    .safeParse(raw);
  if (!parsed.success || !getAsset(symbol)) return false;
  const t = parsed.data,
    now = Date.now(),
    eventTime = t.E || t.T;
  if (eventTime > now + 5000 || now - eventTime > 60000) return false;
  db()
    .prepare('INSERT OR IGNORE INTO live_trades VALUES(?,?,?,?,?,?)')
    .run(symbol, String(t.t), t.p, t.q, t.m ? 'SELL' : 'BUY', t.T);
  db()
    .prepare(
      'UPDATE live_quotes SET price=?,event_time=?,received_at=? WHERE symbol=? AND event_time<=?',
    )
    .run(t.p, eventTime, now, symbol, eventTime);
  return true;
}
export function saveBook(symbol: string, raw: unknown) {
  const parsed = z
    .object({
      lastUpdateId: z.number().int().nonnegative(),
      bids: z.array(z.tuple([positive, decimal])).max(100),
      asks: z.array(z.tuple([positive, decimal])).max(100),
    })
    .safeParse(raw);
  if (!parsed.success || !getAsset(symbol)) return false;
  const v = parsed.data;
  const book = {
    bids: v.bids
      .filter((l) => D(l[1]).gt(0))
      .slice(0, 20)
      .map((l) => ({ price: l[0], quantity: l[1] })),
    asks: v.asks
      .filter((l) => D(l[1]).gt(0))
      .slice(0, 20)
      .map((l) => ({ price: l[0], quantity: l[1] })),
  };
  db()
    .prepare(
      'INSERT INTO live_books VALUES(?,?,?,?) ON CONFLICT(symbol) DO UPDATE SET last_update_id=excluded.last_update_id,book=excluded.book,received_at=excluded.received_at WHERE excluded.last_update_id>live_books.last_update_id',
    )
    .run(symbol, v.lastUpdateId, JSON.stringify(book), Date.now());
  return true;
}
export function saveCandle(
  symbol: string,
  interval: string,
  c: Candle,
  eventTime = Date.now(),
  bootstrap = false,
) {
  const parsed = z
    .object({
      time: z.number().int().positive(),
      open: positive,
      high: positive,
      low: positive,
      close: positive,
      volume: decimal,
    })
    .safeParse(c);
  if (!parsed.success || !getAsset(symbol)) return false;
  if (
    D(c.high).lt(c.open) ||
    D(c.high).lt(c.close) ||
    D(c.low).gt(c.open) ||
    D(c.low).gt(c.close) ||
    D(c.high).lt(c.low)
  )
    return false;
  const values = [symbol, interval, c.time, c.open, c.high, c.low, c.close, c.volume, eventTime];
  if (bootstrap) {
    const seconds = TIMEFRAMES[interval as keyof typeof TIMEFRAMES];
    // REST repairs completed bars; newer open candles retain their streamed values.
    if (seconds && c.time * 1000 + seconds * 1000 <= Date.now())
      db()
        .prepare(
          'INSERT INTO live_candles VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(symbol,interval,time) DO UPDATE SET open=excluded.open,high=excluded.high,low=excluded.low,close=excluded.close,volume=excluded.volume,event_time=excluded.event_time',
        )
        .run(...values);
    else
      db()
        .prepare('INSERT OR IGNORE INTO live_candles VALUES(?,?,?,?,?,?,?,?,?)')
        .run(...values);
  } else
    db()
      .prepare(
        'INSERT INTO live_candles VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(symbol,interval,time) DO UPDATE SET high=excluded.high,low=excluded.low,close=excluded.close,volume=excluded.volume,event_time=excluded.event_time WHERE excluded.event_time>=live_candles.event_time',
      )
      .run(...values);
  return true;
}
