import { db } from '../db';
import {
  ASSETS,
  TIMEFRAMES,
  type Timeframe,
  type Candle,
  type MarketSnapshot,
  type InstrumentRules,
  type Market,
} from '../shared';
import { MAKER, TAKER } from '../money';
import type { MarketProvider } from '../market';
import { feedStatus, type LiveQuote } from './quotes';
import { MAX_QUOTE_AGE_MS, SLIPPAGE_BPS } from './config';
export function subscribeMarket(id: string, symbol: string, interval: Timeframe) {
  db()
    .prepare('INSERT OR REPLACE INTO market_subscriptions VALUES(?,?,?,?)')
    .run(id, symbol, interval, Date.now() + 15000);
}
export function unsubscribeMarket(id: string) {
  db().prepare('DELETE FROM market_subscriptions WHERE id=?').run(id);
}
export function liveSnapshot(symbol: string, timeframe: Timeframe): MarketSnapshot {
  const now = Date.now(),
    rules = db().prepare('SELECT rules FROM instruments').all() as { rules: string }[],
    instruments = Object.fromEntries(
      rules.map((row) => {
        const r = JSON.parse(row.rules) as InstrumentRules;
        return [r.symbol, r];
      }),
    );
  const quotes = db().prepare('SELECT * FROM live_quotes').all() as LiveQuote[];
  const markets: Market[] = ASSETS.map((asset) => {
    const q = quotes.find((q) => q.symbol === asset.symbol),
      r = instruments[asset.symbol],
      supported = r?.spotAllowed && r.status === 'TRADING';
    const stats = q ? JSON.parse(q.stats) : {};
    const spark = (
      db()
        .prepare(
          "SELECT close FROM live_candles WHERE symbol=? AND interval='1h' ORDER BY time DESC LIMIT 25",
        )
        .all(asset.symbol) as { close: string }[]
    )
      .reverse()
      .map((c) => c.close);
    return {
      symbol: asset.symbol,
      name: asset.name,
      price: supported && q ? q.price : null,
      change: supported ? (stats.change ?? null) : null,
      high: supported ? (stats.high ?? null) : null,
      low: supported ? (stats.low ?? null) : null,
      volume: supported ? (stats.volume ?? null) : null,
      spark: supported ? spark : [],
      updatedAt: q?.event_time,
      status: !r ? 'UNAVAILABLE' : !supported ? 'UNSUPPORTED' : feedStatus(asset.symbol, now),
    };
  });
  const quote = quotes.find((q) => q.symbol === symbol),
    book = db().prepare('SELECT * FROM live_books WHERE symbol=?').get(symbol) as
      { book: string; received_at: number } | undefined;
  const candles = (
    db()
      .prepare(
        'SELECT time,open,high,low,close,volume,event_time FROM live_candles WHERE symbol=? AND interval=? ORDER BY time DESC LIMIT 240',
      )
      .all(symbol, timeframe) as (Candle & { event_time: number })[]
  ).reverse();
  const state = db().prepare("SELECT error FROM feed_state WHERE mode='live'").get() as {
    error: string | null;
  };
  const supported = instruments[symbol]?.spotAllowed && instruments[symbol]?.status === 'TRADING';
  const status = supported
    ? feedStatus(symbol, now)
    : instruments[symbol]
      ? 'UNAVAILABLE'
      : feedStatus(undefined, now);
  return {
    source: 'live',
    label: 'Binance Spot · live market data',
    status,
    error:
      !supported && instruments[symbol]
        ? `${symbol}/USDT is not available on Binance Spot.`
        : status !== 'LIVE'
          ? state?.error || 'The Binance feed is reconnecting or stale. Paper execution is paused.'
          : undefined,
    updatedAt: quote?.event_time || 0,
    markets,
    instruments,
    slippageBps: SLIPPAGE_BPS,
    maxQuoteAgeMs: MAX_QUOTE_AGE_MS,
    candles: supported ? candles : [],
    book: supported && book ? JSON.parse(book.book) : { bids: [], asks: [] },
    bookUpdatedAt: book?.received_at,
    candleUpdatedAt: candles.at(-1)?.event_time,
    trades: supported
      ? (db()
          .prepare(
            'SELECT price,quantity,side,time FROM live_trades WHERE symbol=? ORDER BY time DESC LIMIT 20',
          )
          .all(symbol) as MarketSnapshot['trades'])
      : [],
    makerFee: MAKER,
    takerFee: TAKER,
  };
}
export const liveProvider: MarketProvider = {
  async snapshot(symbol, timeframe) {
    subscribeMarket('rest:' + symbol + ':' + timeframe, symbol, timeframe);
    return liveSnapshot(symbol, timeframe);
  },
};
export function validSelection(symbol: string, timeframe: string) {
  return ASSETS.some((a) => a.symbol === symbol) && Object.hasOwn(TIMEFRAMES, timeframe);
}
