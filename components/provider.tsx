'use client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ASSETS,
  type Account,
  type MarketSnapshot,
  type Timeframe,
  type MarketMode,
  type FeedStatus,
} from '@/lib/shared';
import { ClientMarketFeed } from '@/lib/client-feed';
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch('/api/' + path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || result.order?.reason || 'Something went wrong.');
  return result as T;
}
type User = { id: string; name: string; email: string };
type Context = {
  user: User | null;
  account: Account | null;
  authReady: boolean;
  market: MarketSnapshot | null;
  marketError: string;
  feedStatus: FeedStatus;
  symbol: string;
  timeframe: Timeframe;
  mode: MarketMode;
  setSymbol: (v: string) => void;
  setTimeframe: (v: Timeframe) => void;
  setMode: (v: MarketMode) => void;
  refresh: () => Promise<void>;
  toast: (message: string, error?: boolean) => void;
  signOut: () => Promise<void>;
  favorites: string[];
  toggleFavorite: (symbol: string) => void;
};
const AppContext = createContext<Context | null>(null);
export function Provider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null),
    [account, setAccount] = useState<Account | null>(null),
    [authReady, setAuthReady] = useState(false);
  const [market, setMarket] = useState<MarketSnapshot | null>(null),
    [marketError, setMarketError] = useState(''),
    [symbol, setSymbol] = useState('BTC'),
    [timeframe, setTimeframe] = useState<Timeframe>('15m'),
    [mode, updateMode] = useState<MarketMode>('live'),
    [connection, setConnection] = useState<FeedStatus>('RECONNECTING'),
    [now, setNow] = useState(() => Date.now());
  const [favorites, setFavorites] = useState<string[]>([]),
    [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    modeRequest = useRef(0);
  const toast = useCallback((text: string, error = false) => {
    setMessage({ text, error });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setMessage(null), 5000);
  }, []);
  const receiveAccount = useCallback((data: Account | null) => {
    setAccount(data);
    if (data) updateMode(data.marketMode);
  }, []);
  const refresh = useCallback(async () => {
    const session = await api<{ user: User | null }>('session');
    setUser(session.user);
    receiveAccount(session.user ? await api<Account>('account') : null);
    setAuthReady(true);
  }, [receiveAccount]);
  useEffect(() => {
    refresh().catch(() => {
      setAuthReady(true);
      toast('Could not connect to the server.', true);
    });
    try {
      const stored = JSON.parse(localStorage.getItem('orbit.watchlist') || '[]');
      if (Array.isArray(stored))
        setFavorites(
          stored.filter((s) => typeof s === 'string' && ASSETS.some((a) => a.symbol === s)),
        );
    } catch {
      /* Invalid local preferences are ignored. */
    }
  }, [refresh, toast]);
  const toggleFavorite = (value: string) =>
    setFavorites((current) => {
      const next = current.includes(value)
        ? current.filter((s) => s !== value)
        : [...current, value];
      try {
        localStorage.setItem('orbit.watchlist', JSON.stringify(next));
      } catch {
        /* Storage may be disabled. */
      }
      return next;
    });
  const setMode = useCallback(
    (value: MarketMode) => {
      const request = ++modeRequest.current;
      if (!user) {
        updateMode(value);
        return;
      }
      void api<Account>('account/mode', { mode: value })
        .then((data) => {
          if (request === modeRequest.current) {
            receiveAccount(data);
            toast(
              `Switched to ${value === 'live' ? 'Binance Live' : 'Simulated'} market data. Existing orders retain their original mode.`,
            );
          }
        })
        .catch((e) => toast((e as Error).message, true));
    },
    [user, receiveAccount, toast],
  );
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (!user) return;
    let stopped = false,
      inFlight = false;
    const id = setInterval(async () => {
      if (document.hidden || inFlight) return;
      inFlight = true;
      try {
        const data = await api<Account>('account');
        if (!stopped) setAccount(data);
      } catch {
        /* Existing account data stays visible during temporary transport loss. */
      } finally {
        inFlight = false;
      }
    }, 3000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [user]);
  useEffect(() => {
    let disposed = false,
      inFlight = false;
    setMarket(null);
    setMarketError('');
    setConnection('RECONNECTING');
    const receive = (data: MarketSnapshot) => {
      if (disposed) return;
      setMarket(data);
      setConnection(data.status);
      setMarketError(data.error || '');
    };
    const url = `market?symbol=${symbol}&timeframe=${timeframe}&mode=${mode}`;
    const load = async () => {
      if (inFlight || disposed || document.hidden) return;
      inFlight = true;
      try {
        receive(await api<MarketSnapshot>(url));
      } catch (e) {
        if (!disposed) {
          setConnection('RECONNECTING');
          setMarketError((e as Error).message);
        }
      } finally {
        inFlight = false;
      }
    };
    const feed =
      mode === 'live'
        ? new ClientMarketFeed(
            '/api/market/stream?symbol=' + symbol + '&timeframe=' + timeframe + '&mode=live',
            receive,
            () => {
              if (!disposed) {
                setConnection('RECONNECTING');
                setMarketError(
                  'Live feed connection interrupted. Reconnecting; orders are paused.',
                );
              }
            },
          )
        : null;
    const visibility = () => {
      if (document.hidden) {
        feed?.stop();
        setConnection('STALE');
      } else {
        void load();
        feed?.start();
      }
    };
    visibility();
    const heartbeat = () => {
      if (disposed || document.hidden || !feed?.clientId) return;
      void api(
        `market/lease?symbol=${symbol}&timeframe=${timeframe}&mode=live&clientId=${feed.clientId}`,
      ).catch(() => {});
    };
    const leaseTimer = feed ? setInterval(heartbeat, 5000) : null;
    const id = mode === 'simulated' ? setInterval(load, 3500) : null;
    document.addEventListener('visibilitychange', visibility);
    return () => {
      disposed = true;
      if (id) clearInterval(id);
      if (leaseTimer) clearInterval(leaseTimer);
      feed?.stop();
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [symbol, timeframe, mode]);
  const feedStatus: FeedStatus =
    market &&
    ['LIVE', 'SIMULATED'].includes(connection) &&
    market.updatedAt > 0 &&
    now - market.updatedAt > (market.maxQuoteAgeMs || 10000)
      ? 'STALE'
      : connection;
  const signOut = async () => {
    await api('auth/logout', {});
    setUser(null);
    setAccount(null);
    toast('You have signed out.');
  };
  return (
    <AppContext.Provider
      value={{
        user,
        account,
        authReady,
        market,
        marketError,
        feedStatus,
        symbol,
        timeframe,
        mode,
        setSymbol,
        setTimeframe,
        setMode,
        refresh,
        toast,
        signOut,
        favorites,
        toggleFavorite,
      }}
    >
      {children}
      {message && (
        <div
          className={`toast ${message.error ? 'toast-error' : ''}`}
          role={message.error ? 'alert' : 'status'}
        >
          <span className="status-dot" />
          {message.text}
          <button aria-label="Dismiss notification" onClick={() => setMessage(null)}>
            ×
          </button>
        </div>
      )}
    </AppContext.Provider>
  );
}
export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error('Provider missing');
  return context;
};
