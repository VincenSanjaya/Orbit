import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ZodError } from 'zod';
import { register, login, createSession, sessionUser, logout, rateLimit } from '@/lib/auth';
import { AppError } from '@/lib/money';
import { ASSETS, TIMEFRAMES, type Timeframe } from '@/lib/shared';
import { simulatedProvider, publicProvider } from '@/lib/market';
import {
  submitOrder,
  cancelOrder,
  faucet,
  resetAccount,
  syncMarket,
  setMarketMode,
} from '@/lib/trading';

import { subscribeMarket, liveSnapshot } from '@/lib/live/provider';
import { db } from '@/lib/db';
import { account } from '@/lib/portfolio';
import { allowedMutationOrigin } from '@/lib/deployment';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
async function readBody(request: NextRequest): Promise<Record<string, unknown>> {
  if (!request.body) throw new AppError('A JSON object is required.');
  const reader = request.body.getReader();
  let length = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 8192) {
      await reader.cancel();
      throw new AppError('Request body is too large.', 413);
    }
    chunks.push(value);
  }
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new AppError('A JSON object is required.');
  return body;
}
async function handle(request: NextRequest) {
  try {
    const path = request.nextUrl.pathname.slice(5),
      jar = await cookies(),
      token = jar.get('orbit_session')?.value;
    if (request.method === 'POST') {
      if (
        !allowedMutationOrigin(
          request.headers.get('origin'),
          request.headers.get('host'),
          process.env.APP_ORIGIN,
        )
      )
        throw new AppError('Request origin is not allowed.', 403);
      if (request.headers.get('content-type')?.split(';')[0] !== 'application/json')
        throw new AppError('Use application/json.', 415);
      if (Number(request.headers.get('content-length') || 0) > 8192)
        throw new AppError('Request body is too large.', 413);
    }
    if (request.method === 'GET' && ['market', 'market/stream', 'market/lease'].includes(path)) {
      const symbol = request.nextUrl.searchParams.get('symbol') || 'BTC',
        timeframe = request.nextUrl.searchParams.get('timeframe') || '15m',
        mode = request.nextUrl.searchParams.get('mode') || 'live';
      if (
        !ASSETS.some((a) => a.symbol === symbol) ||
        !Object.hasOwn(TIMEFRAMES, timeframe) ||
        !['simulated', 'live'].includes(mode)
      )
        throw new AppError('Unsupported market configuration.');
      const clientId = request.nextUrl.searchParams.get('clientId');
      if (path === 'market/lease') {
        if (mode !== 'live' || !clientId || !/^[0-9a-f-]{36}$/i.test(clientId))
          throw new AppError('Invalid market subscription.');
        subscribeMarket(clientId, symbol, timeframe as Timeframe);
        return json({ ok: true });
      }
      if (path === 'market/stream') {
        if (mode !== 'live') throw new AppError('Streaming is only used for Binance Live mode.');
        if (!clientId || !/^[0-9a-f-]{36}$/i.test(clientId))
          throw new AppError('Invalid stream subscription.');
        const id = clientId;
        subscribeMarket(id, symbol, timeframe as Timeframe);
        let timer: ReturnType<typeof setInterval> | undefined;
        let closed = false;
        const cleanup = () => {
          if (closed) return;
          closed = true;
          if (timer) clearInterval(timer);
          // Browser-owned leases expire after 15s without heartbeats.
        };
        const stream = new ReadableStream({
          start(controller) {
            const send = () => {
              if (closed) return;
              try {
                const lease = db()
                  .prepare('SELECT expires_at FROM market_subscriptions WHERE id=?')
                  .get(id) as { expires_at: number } | undefined;
                if (!lease || lease.expires_at < Date.now()) {
                  cleanup();
                  controller.close();
                  return;
                }
                controller.enqueue(
                  new TextEncoder().encode(
                    'data: ' +
                      JSON.stringify(liveSnapshot(symbol, timeframe as Timeframe)) +
                      '\n\n',
                  ),
                );
              } catch {
                cleanup();
                try {
                  controller.close();
                } catch {
                  /* The connection may already be closed. */
                }
              }
            };
            send();
            timer = setInterval(send, 1000);
            request.signal.addEventListener(
              'abort',
              () => {
                cleanup();
                try {
                  controller.close();
                } catch {
                  /* Already closed. */
                }
              },
              { once: true },
            );
          },
          cancel: cleanup,
        });
        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
          },
        });
      }
      if (mode === 'simulated') syncMarket();
      return json(
        await (mode === 'live' ? publicProvider : simulatedProvider).snapshot(
          symbol,
          timeframe as Timeframe,
        ),
      );
    }
    if (request.method === 'POST' && (path === 'auth/register' || path === 'auth/login')) {
      // One local demo process; coarse shared limiter avoids trusting spoofable forwarded IP headers.
      rateLimit('auth:' + path, 30);
      const body = await readBody(request);
      const user = await (path.endsWith('register') ? register(body) : login(body));
      const session = createSession(user.id);
      jar.set('orbit_session', session.token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.COOKIE_SECURE === 'true',
        expires: new Date(session.expires),
        path: '/',
      });
      return json({ user });
    }
    if (request.method === 'POST' && path === 'auth/logout') {
      logout(token);
      jar.delete('orbit_session');
      return json({ ok: true });
    }
    const user = sessionUser(token);
    if (path === 'session' && request.method === 'GET')
      return json({ user: user ? { id: user.id, email: user.email, name: user.name } : null });
    if (!user) throw new AppError('Please sign in to your account.', 401);
    if (request.method === 'GET' && path === 'account') return json(account(user.id));
    if (request.method === 'POST') {
      rateLimit('actions:' + user.id, 60);
      const body = await readBody(request);
      if (path === 'account/mode') {
        if (body.mode !== 'live' && body.mode !== 'simulated')
          throw new AppError('Unsupported market mode.');
        setMarketMode(user.id, body.mode);
        return json(account(user.id));
      }
      if (path === 'orders') {
        if (!['live', 'simulated'].includes(String(body.mode)))
          throw new AppError('Select a market mode before submitting.');
        const order = submitOrder(user.id, body);
        return json({ order }, order.status === 'REJECTED' ? 422 : 200);
      }
      if (path === 'orders/cancel') {
        if (typeof body.id !== 'string') throw new AppError('Order ID is required.');
        return json({ order: cancelOrder(user.id, body.id) });
      }
      if (path === 'wallet/faucet') {
        faucet(user.id);
        return json({ ok: true });
      }
      if (path === 'wallet/reset') {
        if (body.confirm !== 'RESET') throw new AppError('Type RESET to confirm.');
        resetAccount(user.id);
        return json({ ok: true });
      }
    }
    throw new AppError('Route not found.', 404);
  } catch (error) {
    if (error instanceof ZodError)
      return json({ error: error.issues[0]?.message || 'Invalid input.' }, 400);
    if (error instanceof AppError) return json({ error: error.message }, error.status);
    if (error instanceof SyntaxError) return json({ error: 'Invalid JSON body.' }, 400);
    console.error('ORBIT API error', error);
    return json({ error: 'The server could not complete this request. Please try again.' }, 500);
  }
}
export const GET = handle;
export const POST = handle;
