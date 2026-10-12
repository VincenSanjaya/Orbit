import Decimal from 'decimal.js';
export const REST_URL = process.env.BINANCE_REST_URL || 'https://data-api.binance.vision';
export const WS_URL = process.env.BINANCE_WS_URL || 'wss://data-stream.binance.vision:443';
export const MAX_QUOTE_AGE_MS = Number(process.env.MAX_QUOTE_AGE_MS || 10000);
export const SLIPPAGE_BPS = process.env.PAPER_SLIPPAGE_BPS || '2';
if (!Number.isFinite(MAX_QUOTE_AGE_MS) || MAX_QUOTE_AGE_MS < 1000 || MAX_QUOTE_AGE_MS > 60000)
  throw new Error('Quote freshness threshold must be 1000–60000ms.');

const slippage = new Decimal(SLIPPAGE_BPS);
if (!slippage.isFinite() || slippage.lt(0) || slippage.gt(100))
  throw new Error('Paper slippage must be 0–100 basis points.');
