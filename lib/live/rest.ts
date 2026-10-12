import { AppError } from '../money';
import { REST_URL } from './config';
const allowed = new Set(['exchangeInfo', 'ticker/24hr', 'trades', 'depth', 'klines']);
export class BinanceRest {
  private tail: Promise<unknown> = Promise.resolve();
  private cache = new Map<string, { at: number; value: unknown }>();
  private pending = new Map<string, Promise<unknown>>();
  private cooldown = 0;
  private weights: { time: number; weight: number }[] = [];
  constructor(
    private transport: typeof fetch = fetch,
    private base = REST_URL,
  ) {}
  async get<T>(
    endpoint: string,
    params: Record<string, string | number> = {},
    ttl = 0,
    weight = 2,
  ): Promise<T> {
    if (!allowed.has(endpoint))
      throw new AppError('Only public Binance market-data endpoints are allowed.');
    const path =
        endpoint +
        '?' +
        new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])),
      cached = this.cache.get(path);
    if (cached && Date.now() - cached.at < ttl) return cached.value as T;
    if (this.pending.has(path)) return this.pending.get(path) as Promise<T>;
    const task = this.tail
      .catch(() => {})
      .then(async () => {
        const now = Date.now();
        this.weights = this.weights.filter((w) => w.time > now - 60000);
        if (now < this.cooldown || this.weights.reduce((n, w) => n + w.weight, 0) + weight > 600)
          throw new AppError(
            'Binance rate limit cooldown. Retrying without changing market mode.',
            503,
          );
        await new Promise((resolve) => setTimeout(resolve, 160));
        this.weights.push({ time: Date.now(), weight });
        const response = await this.transport(this.base.replace(/\/$/, '') + '/api/v3/' + path, {
          signal: AbortSignal.timeout(8000),
          cache: 'no-store',
        });
        const used = Number(response.headers.get('x-mbx-used-weight-1m') || 0);
        if (used > 5000) this.cooldown = Date.now() + 60000;
        if (response.status === 429 || response.status === 418) {
          const seconds = Number(response.headers.get('retry-after'));
          this.cooldown =
            Date.now() +
            (Number.isFinite(seconds) && seconds > 0
              ? seconds * 1000
              : response.status === 418
                ? 300000
                : 60000);
          throw new AppError(
            'Binance rate limited the feed. Trading pauses until valid quotes return.',
            503,
          );
        }
        if (!response.ok)
          throw new AppError(`Binance market data unavailable (HTTP ${response.status}).`, 503);
        const value = await response.json();
        this.cache.set(path, { at: Date.now(), value });
        return value;
      })
      .finally(() => this.pending.delete(path));
    this.pending.set(path, task);
    this.tail = task;
    return task as Promise<T>;
  }
}
