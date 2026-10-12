import { db } from '../db';
import { D, AppError } from '../money';
import { getAsset, type FeedStatus, type InstrumentRules, type MarketMode } from '../shared';
import { MAX_QUOTE_AGE_MS } from './config';
export type LiveQuote = {
  symbol: string;
  price: string;
  event_time: number;
  received_at: number;
  stats: string;
};
export function simulatedRules(symbol: string): InstrumentRules {
  const asset = getAsset(symbol);
  if (!asset) throw new AppError('Unsupported market.');
  return {
    symbol,
    exchangeSymbol: symbol + 'USDT',
    status: 'TRADING',
    spotAllowed: true,
    tickSize: asset.tick,
    minPrice: asset.tick,
    maxPrice: '1000000000',
    stepSize: asset.lot,
    minQty: asset.lot,
    maxQty: '1000000000000',
    marketMinQty: '0',
    marketMaxQty: '1000000000000',
    marketStepSize: '0',
    minNotional: '5',
    maxNotional: '1000000000',
    verifiedAt: Date.now(),
    source: 'simulated',
  };
}
export function instrument(symbol: string, mode: MarketMode): InstrumentRules {
  if (mode === 'simulated') return simulatedRules(symbol);
  const row = db()
    .prepare('SELECT rules,verified_at FROM instruments WHERE symbol=?')
    .get(symbol) as { rules: string; verified_at: number } | undefined;
  if (!row || Date.now() - row.verified_at > 86400000)
    throw new AppError('Binance trading rules are unavailable or expired. Trading is paused.', 503);
  const rules = JSON.parse(row.rules) as InstrumentRules;
  if (rules.status !== 'TRADING' || !rules.spotAllowed)
    throw new AppError(`${symbol}/USDT is not an active Binance Spot market.`, 503);
  return rules;
}
export function feedStatus(symbol?: string, now = Date.now()): FeedStatus {
  const state = db().prepare("SELECT * FROM feed_state WHERE mode='live'").get() as
    { status: FeedStatus; lease_until: number; updated_at: number } | undefined;
  if (!state || state.lease_until < now) return 'STALE';
  if (state.status !== 'LIVE') return state.status;
  if (symbol) {
    const quote = db().prepare('SELECT * FROM live_quotes WHERE symbol=?').get(symbol) as
      LiveQuote | undefined;
    if (
      !quote ||
      now - quote.event_time > MAX_QUOTE_AGE_MS ||
      now - quote.received_at > MAX_QUOTE_AGE_MS ||
      quote.event_time > now + 5000
    )
      return 'STALE';
  }
  return 'LIVE';
}
export function validatedQuote(symbol: string, mode: MarketMode, now = Date.now()) {
  if (mode === 'simulated') {
    const row = db()
      .prepare('SELECT price,last_tick FROM market_state WHERE symbol=?')
      .get(symbol) as { price: string; last_tick: number } | undefined;
    if (!row || now - row.last_tick > MAX_QUOTE_AGE_MS)
      throw new AppError('Simulated quote is stale. Try again after the next market tick.', 503);
    return { price: row.price, eventTime: row.last_tick, receivedAt: row.last_tick };
  }
  instrument(symbol, mode);
  if (feedStatus(symbol, now) !== 'LIVE')
    throw new AppError(
      'Binance quote is stale or reconnecting. No order was filled. Try again when LIVE.',
      503,
    );
  const row = db().prepare('SELECT * FROM live_quotes WHERE symbol=?').get(symbol) as LiveQuote;
  if (!D(row.price).isFinite() || D(row.price).lte(0))
    throw new AppError('Invalid Binance price. Trading is paused.', 503);
  return { price: row.price, eventTime: row.event_time, receivedAt: row.received_at };
}
