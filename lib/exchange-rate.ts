import Decimal from 'decimal.js';

export type ExchangeRate = {
  base: 'USD';
  quote: 'IDR';
  rate: string;
  date: string;
  source: 'Frankfurter';
  cached: boolean;
};
const HOUR = 60 * 60 * 1000;
const MAX_AGE = 7 * 24 * HOUR;
let snapshot: ExchangeRate | null = null;
let nextRefresh = 0;
let pending: Promise<ExchangeRate> | null = null;

function usable(rate: ExchangeRate) {
  const age = Date.now() - Date.parse(rate.date + 'T00:00:00Z');
  return Number.isFinite(age) && age >= -24 * HOUR && age <= MAX_AGE;
}

// Shared hourly cache and single-flight fetch prevent one upstream request per wallet.
export async function usdIdrRate(): Promise<ExchangeRate> {
  if (Date.now() < nextRefresh) {
    if (snapshot && usable(snapshot)) return snapshot;
    throw new Error('Rupiah exchange rate is temporarily unavailable.');
  }
  if (pending) return pending;
  pending = (async () => {
    try {
      const response = await fetch('https://api.frankfurter.dev/v2/rate/USD/IDR', {
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error('Exchange rate provider unavailable.');
      const data = await response.json();
      if (
        data.base !== 'USD' ||
        data.quote !== 'IDR' ||
        typeof data.rate !== 'number' ||
        !Number.isFinite(data.rate) ||
        data.rate <= 0 ||
        typeof data.date !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(data.date)
      )
        throw new Error('Invalid exchange rate.');
      const result: ExchangeRate = {
        base: 'USD',
        quote: 'IDR',
        rate: new Decimal(data.rate).toString(),
        date: data.date,
        source: 'Frankfurter',
        cached: false,
      };
      if (!usable(result)) throw new Error('Exchange rate is too old.');
      snapshot = result;
      nextRefresh = Date.now() + HOUR;
      return result;
    } catch {
      nextRefresh = Date.now() + 60000;
      if (snapshot && usable(snapshot)) {
        snapshot = { ...snapshot, cached: true };
        return snapshot;
      }
      throw new Error('Rupiah exchange rate is temporarily unavailable.');
    } finally {
      pending = null;
    }
  })();
  return pending;
}
