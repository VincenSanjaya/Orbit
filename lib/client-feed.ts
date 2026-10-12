import type { MarketSnapshot } from './shared';
export const clientRetryDelay = (attempt: number, random = Math.random) =>
  Math.min(30000, 1000 * 2 ** Math.min(attempt, 10)) * (0.75 + random() * 0.5);
type Source = {
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  close: () => void;
};
/** One shared browser stream; upstream Binance sockets exist only in the worker. */
export class ClientMarketFeed {
  private source: Source | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  private attempt = 0;
  private generation = 0;
  private activeId = '';
  get clientId() {
    return this.activeId;
  }
  constructor(
    private url: string,
    private snapshot: (data: MarketSnapshot) => void,
    private disconnected: () => void,
    private factory: (url: string) => Source = (url) => new EventSource(url),
  ) {}
  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }
  stop() {
    this.stopped = true;
    this.generation++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.source?.close();
    this.source = null;
  }
  private connect() {
    if (this.stopped) return;
    const generation = ++this.generation,
      source = this.factory(
        this.url +
          (this.url.includes('?') ? '&' : '?') +
          'clientId=' +
          (this.activeId = crypto.randomUUID()),
      );
    this.source = source;
    source.onmessage = (event) => {
      if (this.stopped || generation !== this.generation) return;
      try {
        const data = JSON.parse(event.data);
        if (data.source !== 'live') return;
        this.attempt = 0;
        this.snapshot(data);
      } catch {
        /* Bad transport messages never replace valid snapshots. */
      }
    };
    source.onerror = () => {
      if (this.stopped || generation !== this.generation) return;
      source.close();
      this.source = null;
      this.generation++;
      this.disconnected();
      this.timer = setTimeout(() => {
        this.timer = null;
        this.connect();
      }, clientRetryDelay(this.attempt++));
    };
  }
}
