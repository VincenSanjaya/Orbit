import registry from '../config/markets.json';
export type Asset = {
  symbol: string;
  name: string;
  initial: string;
  tick: string;
  lot: string;
  color: string;
  mark: string;
  enabled?: boolean;
};
export const ASSETS: Asset[] = registry.filter(
  (a) => ('enabled' in a ? a.enabled : true) !== false,
);
export const getAsset = (symbol: string) => ASSETS.find((a) => a.symbol === symbol);
export const priceDigits = (symbol: string, tick?: string) => {
  const value = tick || getAsset(symbol)?.tick || '0.01';
  return Math.min(12, (value.replace(/0+$/, '').split('.')[1] || '').length);
};
export type MarketMode = 'live' | 'simulated';
export type FeedStatus = 'LIVE' | 'RECONNECTING' | 'STALE' | 'SIMULATED' | 'UNAVAILABLE';
export type InstrumentRules = {
  symbol: string;
  exchangeSymbol: string;
  status: string;
  spotAllowed: boolean;
  tickSize: string;
  minPrice: string;
  maxPrice: string;
  stepSize: string;
  minQty: string;
  maxQty: string;
  marketMinQty: string;
  marketMaxQty: string;
  marketStepSize: string;
  minNotional: string;
  maxNotional: string;
  verifiedAt: number;
  source: 'binance' | 'simulated';
};
export const TIMEFRAMES = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '4h': 14400,
  '1d': 86400,
} as const;
export type Timeframe = keyof typeof TIMEFRAMES;
export type Candle = {
  time: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
};
export type Market = {
  symbol: string;
  name: string;
  price: string | null;
  change: string | null;
  high: string | null;
  low: string | null;
  volume: string | null;
  updatedAt?: number;
  status?: string;
  spark: string[];
};
export type MarketSnapshot = {
  source: MarketMode;
  status: FeedStatus;
  error?: string;
  instruments: Record<string, InstrumentRules>;
  slippageBps: string;
  maxQuoteAgeMs: number;
  bookUpdatedAt?: number;
  candleUpdatedAt?: number;
  label: string;
  updatedAt: number;
  markets: Market[];
  candles: Candle[];
  trades: { price: string; quantity: string; side: string; time: number }[];
  book: {
    asks: { price: string; quantity: string }[];
    bids: { price: string; quantity: string }[];
  };
  makerFee: string;
  takerFee: string;
};
export type Balance = {
  asset: string;
  available: string;
  reserved: string;
  costBasis: string;
  value: string | null;
  averageCost: string;
  unrealized: string | null;
};
export type Order = {
  id: string;
  user_id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'MARKET' | 'LIMIT';
  quantity: string;
  limit_price: string | null;
  status: 'OPEN' | 'FILLED' | 'CANCELED' | 'REJECTED';
  filled_quantity: string;
  execution_price: string | null;
  fee: string;
  fee_currency: string;
  fee_rate: string;
  reserved: string;
  created_at: number;
  updated_at: number;
  reason: string | null;
  idempotency_key: string;
  request_hash: string;
  mode: MarketMode;
  snapshot_price: string | null;
  quote_time: number | null;
  slippage_bps: string;
};
export type Ledger = {
  id: string;
  asset: string;
  available_delta: string;
  reserved_delta: string;
  kind: string;
  order_id: string | null;
  created_at: number;
};
export type Account = {
  user: { id: string; name: string; email: string; created_at: number };
  balances: Balance[];
  orders: Order[];
  ledger: Ledger[];
  equity: string | null;
  unrealized: string | null;
  realized: string;
  netDeposits: string;
  marketMode: MarketMode;
  valuationStatus: FeedStatus;
  openingFunds: string;
  performance: { time: number; equity: string }[];
};
export const fmt = (value: string | number | null | undefined, digits = 2) =>
  value === null
    ? '—'
    : Number(value || 0).toLocaleString('en-US', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });
export const compact = (value: string | number | null) =>
  value === null
    ? '—'
    : new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(
        Number(value),
      );
export const date = (value: number) =>
  new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
