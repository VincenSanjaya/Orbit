import { describe, it, expect, vi, afterEach } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { MarketConnection, reconnectDelay } from '../lib/live/socket';
import { ClientMarketFeed, clientRetryDelay } from '../lib/client-feed';
import { BinanceRest } from '../lib/live/rest';
import type { MarketSnapshot } from '../lib/shared';
afterEach(() => vi.useRealTimers());
describe('market transport management', () => {
  it('backoff doubles, is bounded, and adds jitter', () => {
    expect(reconnectDelay(0, () => 0)).toBe(750);
    expect(reconnectDelay(1, () => 0.5)).toBe(2000);
    expect(reconnectDelay(20, () => 0.5)).toBe(30000);
    expect(clientRetryDelay(2, () => 1)).toBe(5000);
  });
  it('one socket subscribes, unsubscribes, answers ping, reconnects and stops cleanly', async () => {
    const server = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (typeof address === 'string' || !address) throw new Error('No test port');
    const controls: { method: string; params: string[] }[] = [],
      packets: string[] = [],
      statuses: string[] = [],
      connections: WebSocket[] = [];
    let pongs = 0;
    server.on('connection', (socket) => {
      connections.push(socket);
      socket.on('message', (raw) => {
        const data = JSON.parse(raw.toString());
        controls.push(data);
        if (data.method === 'SUBSCRIBE')
          socket.send(JSON.stringify({ stream: data.params[0], data: { e: '24hrTicker' } }));
      });
      socket.on('pong', () => pongs++);
    });
    const client = new MarketConnection({
      url: `ws://127.0.0.1:${address.port}`,
      onStatus: (s) => statuses.push(s),
      onMessage: (s) => packets.push(s),
      minRetryMs: 10,
      maxRetryMs: 50,
      heartbeatMs: 5000,
    });
    try {
      client.setSubscriptions(['hypeusdt@ticker']);
      client.start();
      await vi.waitFor(() => expect(controls).toHaveLength(1), { timeout: 3000 });
      expect(packets).toEqual(['hypeusdt@ticker']);
      connections[0].ping('heartbeat');
      await vi.waitFor(() => expect(pongs).toBe(1));
      client.setSubscriptions(['btcusdt@ticker']);
      await vi.waitFor(() =>
        expect(
          controls.some((c) => c.method === 'UNSUBSCRIBE' && c.params[0] === 'hypeusdt@ticker'),
        ).toBe(true),
      );
      await vi.waitFor(() =>
        expect(
          controls.some((c) => c.method === 'SUBSCRIBE' && c.params[0] === 'btcusdt@ticker'),
        ).toBe(true),
      );
      connections[0].terminate();
      await vi.waitFor(() => expect(connections.length).toBe(2));
      await vi.waitFor(() =>
        expect(
          controls.filter((c) => c.method === 'SUBSCRIBE' && c.params[0] === 'btcusdt@ticker')
            .length,
        ).toBe(2),
      );
      expect(statuses).toContain('RECONNECTING');
      expect(client.connected).toBe(true);
      client.stop();
      await new Promise((r) => setTimeout(r, 100));
      expect(client.connected).toBe(false);
      expect(connections.length).toBe(2);
    } finally {
      client.stop();
      for (const socket of server.clients) socket.terminate();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it('heartbeat timeout terminates a silent upstream connection', async () => {
    const server = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (typeof address === 'string' || !address) throw new Error('No port');
    let connections = 0;
    server.on('connection', () => connections++);
    const client = new MarketConnection({
      url: `ws://127.0.0.1:${address.port}`,
      onStatus: () => {},
      onMessage: () => {},
      minRetryMs: 10,
      maxRetryMs: 20,
      heartbeatMs: 70,
    });
    try {
      client.start();
      await vi.waitFor(() => expect(connections).toBeGreaterThanOrEqual(2), { timeout: 1500 });
    } finally {
      client.stop();
      for (const socket of server.clients) socket.terminate();
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
  it('browser reconnect reuses a single source and ignores old messages after switching/visibility stop', async () => {
    vi.useFakeTimers();
    const sources: {
        onmessage: ((e: MessageEvent) => void) | null;
        onerror: ((e: Event) => void) | null;
        close: ReturnType<typeof vi.fn>;
      }[] = [],
      received: MarketSnapshot[] = [],
      disconnected = vi.fn();
    const feed = new ClientMarketFeed(
      '/api/market/stream',
      (s) => received.push(s),
      disconnected,
      () => {
        const source = { onmessage: null, onerror: null, close: vi.fn() };
        sources.push(source);
        return source;
      },
    );
    feed.start();
    feed.start();
    expect(sources).toHaveLength(1);
    sources[0].onmessage?.({
      data: JSON.stringify({ source: 'live', status: 'LIVE' }),
    } as MessageEvent);
    expect(received).toHaveLength(1);
    sources[0].onerror?.({} as Event);
    expect(sources[0].close).toHaveBeenCalledOnce();
    expect(disconnected).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1500);
    expect(sources).toHaveLength(2);
    sources[0].onmessage?.({ data: JSON.stringify({ source: 'live' }) } as MessageEvent);
    expect(received).toHaveLength(1);
    feed.stop();
    await vi.advanceTimersByTimeAsync(40000);
    expect(sources).toHaveLength(2);
    feed.start();
    expect(sources).toHaveLength(3);
    feed.stop();
  });
  it('REST coalesces duplicate calls, honors Retry-After and restricts endpoints to market data', async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ symbol: 'HYPEUSDT', lastPrice: '40' }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response('{}', { status: 429, headers: { 'retry-after': '60' } }));
    const rest = new BinanceRest(transport, 'https://data-api.binance.vision');
    const [a, b] = await Promise.all([
      rest.get('ticker/24hr', { symbol: 'HYPEUSDT' }, 10000),
      rest.get('ticker/24hr', { symbol: 'HYPEUSDT' }, 10000),
    ]);
    expect(a).toEqual(b);
    expect(transport).toHaveBeenCalledTimes(1);
    await expect(rest.get('depth', { symbol: 'HYPEUSDT' })).rejects.toThrow('rate limited');
    await expect(rest.get('trades', { symbol: 'HYPEUSDT' })).rejects.toThrow('cooldown');
    expect(transport).toHaveBeenCalledTimes(2);
    await expect(rest.get('order', {})).rejects.toThrow('Only public');
  });
});
