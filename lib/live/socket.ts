import WebSocket from 'ws';
export const reconnectDelay = (attempt: number, random = Math.random, min = 1000, max = 30000) =>
  Math.min(max, min * 2 ** Math.min(attempt, 10)) * (0.75 + random() * 0.5);
export type ConnectionOptions = {
  url: string;
  onMessage: (stream: string, data: unknown) => void;
  onStatus: (status: 'LIVE' | 'RECONNECTING', reason?: string) => void;
  minRetryMs?: number;
  maxRetryMs?: number;
  heartbeatMs?: number;
  rotateMs?: number;
};
/** A single market-data-only combined socket. Control messages are batched and paced. */
export class MarketConnection {
  private socket: WebSocket | null = null;
  private wanted = new Set<string>();
  private sent = new Set<string>();
  private attempt = 0;
  private stopped = true;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setTimeout> | null = null;
  private rotation: ReturnType<typeof setTimeout> | null = null;
  private control: ReturnType<typeof setTimeout> | null = null;
  private id = 1;
  constructor(private options: ConnectionOptions) {}
  setSubscriptions(streams: string[]) {
    this.wanted = new Set(streams);
    this.scheduleControl();
  }
  get connected() {
    return this.socket?.readyState === WebSocket.OPEN;
  }
  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }
  stop() {
    this.stopped = true;
    for (const timer of [this.retry, this.heartbeat, this.rotation, this.control])
      if (timer) clearTimeout(timer);
    this.retry = this.heartbeat = this.rotation = this.control = null;
    this.socket?.terminate();
    this.socket = null;
    this.sent.clear();
  }
  private armHeartbeat(socket: WebSocket) {
    if (this.heartbeat) clearTimeout(this.heartbeat);
    this.heartbeat = setTimeout(() => socket.terminate(), this.options.heartbeatMs || 35000);
  }
  private connect() {
    if (this.stopped) return;
    this.options.onStatus('RECONNECTING', 'Connecting to Binance');
    const socket = new WebSocket(this.options.url.replace(/\/$/, '') + '/stream', {
      handshakeTimeout: 10000,
      maxPayload: 2 * 1024 * 1024,
    });
    this.socket = socket;
    this.sent.clear();
    socket.on('open', () => {
      if (this.socket !== socket || this.stopped) return;
      this.armHeartbeat(socket);
      this.options.onStatus('LIVE');
      this.scheduleControl();
      this.rotation = setTimeout(
        () => socket.close(1000, 'Scheduled rotation'),
        this.options.rotateMs || 23 * 3600000 + 55 * 60000,
      );
    });
    // ws automatically echoes each server ping payload in a pong frame.
    socket.on('ping', () => this.armHeartbeat(socket));
    socket.on('pong', () => this.armHeartbeat(socket));
    socket.on('message', (raw) => {
      if (this.socket !== socket || this.stopped) return;
      this.armHeartbeat(socket);
      try {
        const packet = JSON.parse(raw.toString());
        if (packet.code !== undefined) {
          this.options.onStatus('RECONNECTING', 'Binance subscription rejected');
          socket.terminate();
          return;
        }
        if (packet.stream && packet.data) {
          this.attempt = 0;
          this.options.onMessage(packet.stream, packet.data);
        }
      } catch {
        /* Invalid payloads do not enter price state. */
      }
    });
    socket.on('error', () => {
      if (!this.stopped) {
        this.options.onStatus('RECONNECTING', 'Binance connection unavailable');
        socket.terminate();
      }
    });
    socket.on('close', () => {
      if (this.socket !== socket) return;
      for (const timer of [this.heartbeat, this.rotation, this.control])
        if (timer) clearTimeout(timer);
      this.heartbeat = this.rotation = this.control = null;
      this.socket = null;
      this.sent.clear();
      if (this.stopped) return;
      this.options.onStatus('RECONNECTING', 'Binance connection lost; retrying');
      const delay = reconnectDelay(
        this.attempt++,
        Math.random,
        this.options.minRetryMs || 1000,
        this.options.maxRetryMs || 30000,
      );
      this.retry = setTimeout(() => {
        this.retry = null;
        this.connect();
      }, delay);
    });
  }
  private scheduleControl() {
    if (this.control || this.stopped || this.socket?.readyState !== WebSocket.OPEN) return;
    this.control = setTimeout(() => {
      this.control = null;
      const socket = this.socket;
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      const removals = [...this.sent].filter((s) => !this.wanted.has(s)),
        additions = [...this.wanted].filter((s) => !this.sent.has(s));
      if (removals.length) {
        socket.send(JSON.stringify({ method: 'UNSUBSCRIBE', params: removals, id: this.id++ }));
        removals.forEach((s) => this.sent.delete(s));
      } else if (additions.length) {
        socket.send(JSON.stringify({ method: 'SUBSCRIBE', params: additions, id: this.id++ }));
        additions.forEach((s) => this.sent.add(s));
      }
      if (removals.length && additions.length) this.scheduleControl();
    }, 350);
  }
}
