import { randomUUID } from 'node:crypto';
import { db } from '../db';
import { TIMEFRAMES, type Timeframe } from '../shared';
import { syncMarket, matchPending } from '../trading';
import { BinanceRest } from './rest';
import { MarketConnection } from './socket';
import { WS_URL } from './config';
import {
  saveInstruments,
  saveTicker,
  saveTrade,
  saveBook,
  saveCandle,
  type ExchangeSymbol,
} from './ingest';
/** Only the database lease owner opens the upstream socket. API processes read shared snapshots. */
export class LiveMarketWorker {
  private owner = randomUUID();
  private socket: MarketConnection | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private leader = false;
  private stopped = false;
  private busy = false;
  private verifiedAt = 0;
  private supported: string[] = [];
  private bootstrapped = new Map<string, number>();
  private active = new Set<string>();
  constructor(private rest = new BinanceRest()) {}
  start() {
    if (this.timer) return;
    this.stopped = false;
    void this.cycle();
    this.timer = setInterval(() => {
      try {
        if (!this.stopped && this.acquire()) {
          this.leader = true;
          syncMarket();
        }
      } catch (error) {
        console.error('Market worker tick failed', error);
      }
      void this.cycle();
    }, 3000);
  }
  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.socket?.stop();
    this.socket = null;
    db()
      .prepare(
        "UPDATE feed_state SET status='STALE',error='Market worker stopped',lease_until=0 WHERE mode='live' AND owner=?",
      )
      .run(this.owner);
    this.leader = false;
  }
  private acquire() {
    return db()
      .transaction(() => {
        const state = db()
          .prepare("SELECT owner,lease_until FROM feed_state WHERE mode='live'")
          .get() as { owner: string; lease_until: number };
        if (state.owner !== this.owner && state.lease_until > Date.now()) return false;
        db()
          .prepare("UPDATE feed_state SET owner=?,lease_until=? WHERE mode='live'")
          .run(this.owner, Date.now() + 12000);
        return true;
      })
      .immediate();
  }
  private status(status: 'LIVE' | 'RECONNECTING', error?: string) {
    if (this.leader && !this.stopped)
      db()
        .prepare(
          "UPDATE feed_state SET status=?,error=?,updated_at=? WHERE mode='live' AND owner=?",
        )
        .run(status, error || null, Date.now(), this.owner);
  }
  async cycle() {
    if (this.stopped || this.busy) return;
    this.busy = true;
    try {
      if (!this.acquire()) {
        if (this.leader) {
          this.socket?.stop();
          this.socket = null;
          this.leader = false;
        }
        return;
      }
      this.leader = true;
      syncMarket();
      if (Date.now() - this.verifiedAt > 300000) {
        this.status('RECONNECTING', 'Checking Binance Spot instruments');
        const info = await this.rest.get<{ symbols: ExchangeSymbol[] }>(
          'exchangeInfo',
          {},
          300000,
          20,
        );
        if (this.stopped || !this.acquire()) return;
        const rules = saveInstruments(info.symbols);
        this.supported = rules
          .filter((r) => r.spotAllowed && r.status === 'TRADING')
          .map((r) => r.symbol);
        this.verifiedAt = Date.now();
        const tickers = await this.rest.get<unknown[]>(
          'ticker/24hr',
          { symbols: JSON.stringify(this.supported.map((s) => s + 'USDT')) },
          1000,
          2,
        );
        for (const ticker of tickers) saveTicker(ticker, 'rest');
        if (!this.socket) {
          this.socket = new MarketConnection({
            url: WS_URL,
            onStatus: (status, error) => this.status(status, error),
            onMessage: (stream, data) => this.message(stream, data),
          });
          this.socket.setSubscriptions(
            this.supported.flatMap((s) => [
              s.toLowerCase() + 'usdt@ticker',
              s.toLowerCase() + 'usdt@kline_1h',
            ]),
          );
          this.socket.start();
        } else if (this.socket.connected) this.status('LIVE');
      }
      db().prepare('DELETE FROM market_subscriptions WHERE expires_at<?').run(Date.now());
      const leases = db()
        .prepare('SELECT DISTINCT symbol,interval FROM market_subscriptions WHERE expires_at>?')
        .all(Date.now()) as { symbol: string; interval: Timeframe }[];
      const wanted = new Set<string>(
        this.supported.flatMap((s) => [
          s.toLowerCase() + 'usdt@ticker',
          s.toLowerCase() + 'usdt@kline_1h',
        ]),
      );
      for (const lease of leases.filter(
        (l) => this.supported.includes(l.symbol) && Object.hasOwn(TIMEFRAMES, l.interval),
      )) {
        const pair = lease.symbol.toLowerCase() + 'usdt';
        wanted.add(pair + '@trade');
        wanted.add(pair + '@depth20');
        wanted.add(pair + '@kline_' + lease.interval);
      }
      // Genuine hourly candles for each asset provide compact 24h sparklines.
      const missing = this.supported
        .map((symbol) => ({ symbol, interval: '1h' as Timeframe }))
        .filter(
          (l) => Date.now() - (this.bootstrapped.get(l.symbol + ':' + l.interval) || 0) >= 60000,
        );
      this.socket?.setSubscriptions([...wanted]);
      this.active = wanted;
      const requested = [...leases, ...missing].filter(
        (l) => this.supported.includes(l.symbol) && Object.hasOwn(TIMEFRAMES, l.interval),
      );
      for (const lease of requested) {
        if (this.stopped || !this.acquire()) break;
        const key = lease.symbol + ':' + lease.interval;
        if (Date.now() - (this.bootstrapped.get(key) || 0) < 60000) continue;
        try {
          await this.bootstrap(
            lease.symbol,
            lease.interval,
            leases.some((l) => l.symbol === lease.symbol),
          );
          this.bootstrapped.set(key, Date.now());
        } catch (error) {
          console.warn('Binance bootstrap pending:', (error as Error).message);
          break;
        }
      }
      if (!this.stopped && this.acquire())
        db()
          .transaction(() => matchPending('live'))
          .immediate();
      db()
        .prepare('DELETE FROM live_trades WHERE time<?')
        .run(Date.now() - 86400000);
    } catch (error) {
      this.status('RECONNECTING', (error as Error).message);
    } finally {
      this.busy = false;
    }
  }
  private async bootstrap(symbol: string, interval: Timeframe, details: boolean) {
    const rows = await this.rest.get<(string | number)[][]>(
      'klines',
      { symbol: symbol + 'USDT', interval, limit: interval === '1h' ? 240 : 240 },
      60000,
    );
    if (this.stopped || !this.acquire()) return;
    db()
      .transaction(() => {
        for (const row of rows)
          saveCandle(
            symbol,
            interval,
            {
              time: Number(row[0]) / 1000,
              open: String(row[1]),
              high: String(row[2]),
              low: String(row[3]),
              close: String(row[4]),
              volume: String(row[5]),
            },
            Date.now(),
            true,
          );
      })
      .immediate();
    if (details) {
      const book = await this.rest.get<unknown>(
        'depth',
        { symbol: symbol + 'USDT', limit: 20 },
        30000,
        5,
      );
      if (!this.stopped && this.acquire()) saveBook(symbol, book);
      const trades = await this.rest.get<
        { id: number; price: string; qty: string; time: number; isBuyerMaker: boolean }[]
      >('trades', { symbol: symbol + 'USDT', limit: 20 }, 30000, 25);
      if (!this.stopped && this.acquire())
        for (const t of trades)
          saveTrade(symbol, { t: t.id, p: t.price, q: t.qty, T: t.time, m: t.isBuyerMaker });
    }
  }
  private message(stream: string, raw: unknown) {
    if (!this.leader || this.stopped || !raw || typeof raw !== 'object') return;
    const data = raw as Record<string, unknown>,
      symbol = stream.split('@')[0].replace(/usdt$/, '').toUpperCase();
    if (!this.supported.includes(symbol)) return;
    db()
      .transaction(() => {
        // Guard lease ownership inside the same write lock as ingestion and matching.
        const state = db()
          .prepare("SELECT owner,lease_until FROM feed_state WHERE mode='live'")
          .get() as { owner: string; lease_until: number };
        if (state.owner !== this.owner || state.lease_until < Date.now()) return;
        if (stream.endsWith('@ticker')) saveTicker(data);
        else if (stream.endsWith('@trade')) saveTrade(symbol, data);
        else if (stream.endsWith('@depth20')) saveBook(symbol, data);
        else if (stream.includes('@kline_') && data.k && typeof data.k === 'object') {
          const k = data.k as Record<string, string | number>,
            interval = stream.split('@kline_')[1];
          const eventTime = Number(data.E);
          if (
            Number.isSafeInteger(eventTime) &&
            eventTime <= Date.now() + 5000 &&
            Date.now() - eventTime < 60000 &&
            String(k.i) === interval &&
            String(k.s) === symbol + 'USDT'
          )
            saveCandle(
              symbol,
              interval,
              {
                time: Number(k.t) / 1000,
                open: String(k.o),
                high: String(k.h),
                low: String(k.l),
                close: String(k.c),
                volume: String(k.v),
              },
              eventTime,
            );
        }
        if (stream.endsWith('@ticker') || stream.endsWith('@trade')) matchPending('live');
      })
      .immediate();
  }
  diagnostics() {
    return { leader: this.leader, activeStreams: [...this.active], supported: this.supported };
  }
}
