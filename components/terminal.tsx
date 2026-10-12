'use client';
import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import Decimal from 'decimal.js';
import {
  ArrowUpRight,
  ArrowDownUp,
  ChevronDown,
  Expand,
  ChartCandlestick,
  LockKeyhole,
  ArrowRight,
} from 'lucide-react';
import {
  ASSETS,
  TIMEFRAMES,
  fmt,
  compact,
  priceDigits,
  type Timeframe,
  type Order,
} from '@/lib/shared';
import { useApp, api } from './provider';
import { Coin, Modal, SourceStatus, SearchInput } from './ui';
import { OrderTable } from './tables';
const Chart = dynamic(() => import('./chart'), {
  ssr: false,
  loading: () => <div className="skeleton chart-skeleton" />,
});
export function Book({ preview = false }: { preview?: boolean }) {
  const { market, symbol } = useApp();
  const depth = (levels: { price: string; quantity: string }[]) =>
    levels.slice(0, preview ? 6 : 9).map((row, i) => ({
      ...row,
      cumulative: levels.slice(0, i + 1).reduce((n, l) => n.add(l.quantity), new Decimal(0)),
    }));
  const asks = depth(market?.book.asks || []),
    bids = depth(market?.book.bids || []);
  const marketAsset = market?.markets.find((m) => m.symbol === symbol),
    digits = priceDigits(symbol, market?.instruments[symbol]?.tickSize);
  return (
    <section className={`order-book ${preview ? 'preview-book' : ''}`}>
      <div className="panel-heading">
        <h3>Order book</h3>
        <span
          title={market?.source === 'live' ? 'Binance depth' : 'Indicative simulated depth'}
          className="muted"
        >
          <ArrowDownUp size={14} />
        </span>
      </div>
      <div className="book-header">
        <span>Price (USDT)</span>
        <span>Amount ({symbol})</span>
        <span>Total ({symbol})</span>
      </div>
      {[...asks].reverse().map((row, i) => (
        <div className="book-row" key={i}>
          <i
            className="depth ask"
            style={{
              width:
                row.cumulative
                  .div(asks.at(-1)?.cumulative || 1)
                  .mul(100)
                  .toFixed(2) + '%',
            }}
          />
          <span className="negative">{fmt(row.price, digits)}</span>
          <span>{fmt(row.quantity, 5)}</span>
          <span>{fmt(row.cumulative.toString(), 5)}</span>
        </div>
      ))}
      <div className="book-mid">
        <strong className={Number(marketAsset?.change) >= 0 ? 'positive' : 'negative'}>
          {fmt(marketAsset?.price, digits)} <ArrowUpRight size={15} />
        </strong>
        <span>≈ ${fmt(marketAsset?.price, digits)}</span>
      </div>
      {bids.map((row, i) => (
        <div className="book-row" key={i}>
          <i
            className="depth bid"
            style={{
              width:
                row.cumulative
                  .div(bids.at(-1)?.cumulative || 1)
                  .mul(100)
                  .toFixed(2) + '%',
            }}
          />
          <span className="positive">{fmt(row.price, digits)}</span>
          <span>{fmt(row.quantity, 5)}</span>
          <span>{fmt(row.cumulative.toString(), 5)}</span>
        </div>
      ))}
      <div className="book-note">
        Spread{' '}
        {market && market.book.asks.length && market.book.bids.length
          ? fmt(
              new Decimal(market.book.asks[0]?.price || 0)
                .sub(market.book.bids[0]?.price || 0)
                .toString(),
              digits,
            )
          : '—'}{' '}
        · {market?.source === 'live' ? 'Binance depth' : 'Indicative simulated depth'}
        {market?.source === 'live' &&
        market.bookUpdatedAt &&
        market.updatedAt - market.bookUpdatedAt > 15000
          ? ' · STALE DEPTH'
          : ''}
      </div>
    </section>
  );
}
function OrderTicket() {
  const { user, account, market, symbol, mode, marketError, feedStatus, refresh, toast } = useApp(),
    [side, setSide] = useState<'BUY' | 'SELL'>('BUY'),
    [type, setType] = useState<'MARKET' | 'LIMIT'>('MARKET'),
    [quantity, setQuantity] = useState(''),
    [limit, setLimit] = useState(''),
    [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false);
  const requestKey = useRef<string | null>(null);
  const asset = ASSETS.find((a) => a.symbol === symbol)!,
    price = market?.markets.find((m) => m.symbol === symbol)?.price || '0',
    rate = (type === 'LIMIT' ? market?.makerFee : market?.takerFee) || '0.0015';
  const rules = market?.instruments[symbol];
  const lot = rules?.stepSize && Number(rules.stepSize) > 0 ? rules.stepSize : asset.lot,
    tick = rules?.tickSize && Number(rules.tickSize) > 0 ? rules.tickSize : asset.tick,
    minNotional = rules?.minNotional || '5';
  const ready =
    mode === 'live' ? feedStatus === 'LIVE' && rules?.spotAllowed : feedStatus === 'SIMULATED';
  const available =
    account?.balances.find((b) => b.asset === (side === 'BUY' ? 'USDT' : symbol))?.available || '0';
  const modeledPrice = () => {
    const base = new Decimal(price);
    if (mode !== 'live') return base;
    const moved = base.mul(
      new Decimal(1).add(
        new Decimal(market?.slippageBps || 0).div(10000).mul(side === 'BUY' ? 1 : -1),
      ),
    );
    return side === 'BUY' ? moved.div(tick).ceil().mul(tick) : moved.div(tick).floor().mul(tick);
  };
  let notional = new Decimal(0),
    fee = new Decimal(0),
    qty = new Decimal(0);
  try {
    qty = new Decimal(quantity || 0);
    notional = qty.mul(type === 'LIMIT' ? limit || 0 : modeledPrice()).toDecimalPlaces(8);
    fee = notional.mul(rate).toDecimalPlaces(8);
  } catch {
    /* Invalid partial input keeps the preview at zero. */
  }
  const total = side === 'BUY' ? notional.add(fee) : notional.sub(fee);
  useEffect(() => {
    setQuantity('');
    setLimit('');
    requestKey.current = null;
  }, [symbol]);
  const percent = (p: number) => {
    const reference = type === 'LIMIT' ? limit || price : modeledPrice().toFixed();
    if (!Number(reference)) return;
    const max =
      side === 'BUY'
        ? new Decimal(available).div(new Decimal(reference).mul(new Decimal(1).add(rate)))
        : new Decimal(available);
    const amount = max.mul(p).div(lot).floor().mul(lot);
    setQuantity(amount.toFixed());
    requestKey.current = null;
  };
  const submit = async () => {
    setBusy(true);
    requestKey.current ||= crypto.randomUUID();
    try {
      const result = await api<{ order: Order }>('orders', {
        symbol,
        side,
        type,
        quantity,
        price: type === 'LIMIT' ? limit : undefined,
        idempotencyKey: requestKey.current,
        mode,
      });
      toast(
        result.order.status === 'FILLED'
          ? `${side === 'BUY' ? 'Bought' : 'Sold'} ${result.order.filled_quantity} ${symbol}. Fee: ${fmt(result.order.fee, 4)} USDT.`
          : 'Limit order placed. Funds are reserved.',
      );
      setConfirm(false);
      setQuantity('');
      requestKey.current = null;
      await refresh();
    } catch (e) {
      toast((e as Error).message, true);
      await refresh();
    } finally {
      setBusy(false);
    }
  };
  const prepare = () => {
    if (!qty.isFinite() || qty.lte(0) || !qty.mod(lot).isZero()) {
      toast(`Enter a quantity in increments of ${lot} ${symbol}.`, true);
      return;
    }
    if (type === 'LIMIT' && (!Number(limit) || !new Decimal(limit).mod(tick).isZero())) {
      toast(`Price must use ${tick} USDT increments.`, true);
      return;
    }
    if (notional.lt(minNotional)) {
      toast(`Minimum order value is ${new Decimal(minNotional).toFixed()} USDT.`, true);
      return;
    }
    if ((side === 'BUY' ? total : qty).gt(available)) {
      toast('Insufficient available funds.', true);
      return;
    }
    setConfirm(true);
  };
  return (
    <section className="order-ticket">
      <div className="panel-heading">
        <h3>Place order</h3>
        <span className="demo-badge">PAPER</span>
      </div>
      <div className="side-switch">
        <button
          className={side === 'BUY' ? 'selected-buy' : ''}
          onClick={() => {
            setSide('BUY');
            requestKey.current = null;
          }}
        >
          Buy
        </button>
        <button
          className={side === 'SELL' ? 'selected-sell' : ''}
          onClick={() => {
            setSide('SELL');
            requestKey.current = null;
          }}
        >
          Sell
        </button>
      </div>
      <div className="tabs ticket-tabs">
        {(['MARKET', 'LIMIT'] as const).map((t) => (
          <button
            key={t}
            onClick={() => {
              setType(t);
              requestKey.current = null;
              if (t === 'LIMIT' && !limit)
                setLimit(new Decimal(price).div(tick).round().mul(tick).toFixed());
            }}
            className={type === t ? 'active' : ''}
          >
            {t === 'MARKET' ? 'Market' : 'Limit'}
          </button>
        ))}
      </div>
      <div className="available">
        <span>Available</span>
        <strong>
          {fmt(available, side === 'BUY' ? 2 : 5)} {side === 'BUY' ? 'USDT' : symbol}
        </strong>
      </div>
      <label className="ticket-input">
        <span>Price</span>
        {type === 'LIMIT' ? (
          <input
            aria-label="Limit price"
            inputMode="decimal"
            type="number"
            min={tick}
            step={tick}
            value={limit}
            onChange={(e) => {
              setLimit(e.target.value);
              requestKey.current = null;
            }}
          />
        ) : (
          <span className="market-price">Market price</span>
        )}
        <strong>USDT</strong>
      </label>
      <label className="ticket-input">
        <span>Amount</span>
        <input
          aria-label="Order quantity"
          inputMode="decimal"
          type="number"
          min={lot}
          step={lot}
          placeholder="0.00"
          value={quantity}
          onChange={(e) => {
            setQuantity(e.target.value);
            requestKey.current = null;
          }}
        />
        <strong>{symbol}</strong>
      </label>
      <div className="percent-buttons">
        {[0.25, 0.5, 0.75, 1].map((p) => (
          <button key={p} onClick={() => percent(p)}>
            {p * 100}%
          </button>
        ))}
      </div>
      <div className="ticket-calculation">
        <div>
          <span>Order value</span>
          <span>{fmt(notional.toString())} USDT</span>
        </div>
        <div>
          <span>Paper fee ({new Decimal(rate).mul(100).toFixed(2)}%)</span>
          <span>{fmt(fee.toString(), 4)} USDT</span>
        </div>
        {mode === 'live' && (
          <div>
            <span>Paper slippage</span>
            <span>{market?.slippageBps || '0'} bps · limit capped</span>
          </div>
        )}
        <div className="ticket-total">
          <span>{side === 'BUY' ? 'Total debit' : 'You receive'}</span>
          <strong>{fmt(total.toString())} USDT</strong>
        </div>
        {side === 'BUY' && (
          <div>
            <span>You receive</span>
            <span>
              {qty.toFixed()} {symbol}
            </span>
          </div>
        )}
      </div>
      {!user ? (
        <Link href="/login" className="button primary full">
          Sign in to trade <ArrowRight size={16} />
        </Link>
      ) : (
        <button
          className={`button full ${side === 'BUY' ? 'primary' : 'sell-button'}`}
          disabled={!ready || !!marketError || !market || busy}
          onClick={prepare}
        >
          {side === 'BUY' ? 'Buy' : 'Sell'} {symbol}
          <ArrowUpRight size={16} />
        </button>
      )}
      <p className="ticket-disclaimer">
        <LockKeyhole size={12} />
        {mode === 'live'
          ? 'Live market account · paper fills only. Quotes are not guaranteed executable prices.'
          : 'Virtual funds only. All-or-nothing fills. No real custody.'}
      </p>
      <Modal
        open={confirm}
        onOpenChange={(v) => {
          if (!busy) setConfirm(v);
        }}
        title={`Confirm ${side.toLowerCase()} order`}
        description={
          type === 'MARKET'
            ? 'Paper orders settle at the latest validated server quote, with the displayed slippage and fees. Stale quotes cannot fill.'
            : 'Funds are reserved. Full-quantity paper fills use fresh quotes from this order’s selected market source and cannot exceed your limit.'
        }
      >
        <div className="confirm-details">
          <div>
            <span>Pair / type</span>
            <strong>
              {symbol}/USDT · {type}
            </strong>
          </div>
          <div>
            <span>Quantity</span>
            <strong>
              {quantity} {symbol}
            </strong>
          </div>
          <div>
            <span>Estimated fee (USDT)</span>
            <strong>{fmt(fee.toString(), 4)}</strong>
          </div>
          <div>
            <span>{side === 'BUY' ? 'Estimated debit' : 'Estimated receipt'}</span>
            <strong>{fmt(total.toString())} USDT</strong>
          </div>
        </div>
        <button className="button primary full" disabled={busy} onClick={submit}>
          {busy ? 'Submitting…' : 'Confirm paper order'}
        </button>
      </Modal>
    </section>
  );
}
export function TradingTerminal({
  initialSymbol = 'BTC',
  preview = false,
}: {
  initialSymbol?: string;
  preview?: boolean;
}) {
  const {
      market,
      symbol,
      setSymbol,
      timeframe,
      setTimeframe,
      account,
      marketError,
      mode,
      feedStatus,
    } = useApp(),
    [pairOpen, setPairOpen] = useState(false),
    [search, setSearch] = useState(''),
    [tab, setTab] = useState('open'),
    [expanded, setExpanded] = useState(false);
  useEffect(() => {
    setSymbol(initialSymbol);
  }, [initialSymbol, setSymbol]);
  const m = market?.markets.find((m) => m.symbol === symbol),
    digits = priceDigits(symbol, market?.instruments[symbol]?.tickSize);
  const chartPart = (
    <div className="chart-panel">
      <div className="chart-toolbar">
        <div>
          <ChartCandlestick size={15} />
          <span>{symbol}/USDT</span>
          <span className="muted">· Spot</span>
        </div>
        <div className="timeframes">
          {(Object.keys(TIMEFRAMES) as Timeframe[]).map((t) => (
            <button
              key={t}
              className={timeframe === t ? 'active' : ''}
              onClick={() => setTimeframe(t)}
            >
              {t}
            </button>
          ))}
        </div>
        {!preview && (
          <button
            className="icon-button"
            aria-label="Expand chart"
            onClick={() => setExpanded(true)}
          >
            <Expand size={14} />
          </button>
        )}
      </div>
      <div className="chart-ohlc">
        <span className="positive">{m ? fmt(m.price, digits) : 'Loading market…'}</span>
        <span>
          H <b>{m ? fmt(m.high, digits) : '—'}</b>
        </span>
        <span>
          L <b>{m ? fmt(m.low, digits) : '—'}</b>
        </span>
        <span>Volume · {market?.source === 'live' ? 'Binance' : 'simulated'}</span>
      </div>
      {market && market.candles.length ? (
        <Chart
          tickSize={market.instruments[symbol]?.tickSize}
          candles={market.candles}
          identity={symbol + timeframe}
          height={preview ? 295 : 385}
        />
      ) : (
        <div className="skeleton chart-skeleton" />
      )}
      <div className="chart-footer">
        <span>ORBIT {market?.source === 'live' ? 'Binance live market' : 'simulated market'}</span>
        <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">
          Charts by TradingView
        </a>
      </div>
    </div>
  );
  return (
    <div className={`terminal ${preview ? 'terminal-preview' : ''}`}>
      {preview && (
        <div className="preview-topbar">
          <span className="tiny-orbit">◉</span>
          <strong>ORBIT TERMINAL</strong>
          <span className="preview-live">
            <i className="status-dot" />
            {mode === 'live' ? 'BINANCE ' + feedStatus : 'SIMULATED MARKET'}
          </span>
          <Link href="/trade/BTC-USDT">
            Open exchange <ArrowUpRight size={13} />
          </Link>
        </div>
      )}
      {!preview && <SourceStatus />}
      <div className="pair-bar">
        <button
          className="pair-selector"
          onClick={() => setPairOpen(true)}
          aria-label="Select trading pair"
        >
          <Coin symbol={symbol} />
          <div>
            <strong>
              {symbol}
              <span className="muted"> / USDT</span>
            </strong>
            <span>{ASSETS.find((a) => a.symbol === symbol)?.name}</span>
          </div>
          <ChevronDown size={15} />
        </button>
        <div className="pair-price">
          <strong key={m?.price} className="price-tick">
            {m ? fmt(m.price, digits) : '—'}
          </strong>
          <span>≈ ${m ? fmt(m.price, digits) : '—'}</span>
        </div>
        <div className="market-metric">
          <span>24h change</span>
          <strong className={Number(m?.change) >= 0 ? 'positive' : 'negative'}>
            {Number(m?.change) >= 0 ? '+' : ''}
            {fmt(m?.change)}%
          </strong>
        </div>
        <div className="market-metric">
          <span>24h high</span>
          <strong>{m ? fmt(m.high, digits) : '—'}</strong>
        </div>
        <div className="market-metric">
          <span>24h low</span>
          <strong>{m ? fmt(m.low, digits) : '—'}</strong>
        </div>
        <div className="market-metric volume-metric">
          <span>24h volume (USDT)</span>
          <strong>{m ? compact(m.volume) : '—'}</strong>
        </div>
        {!preview && <span className="demo-badge">PAPER TRADING</span>}
      </div>
      {marketError && !preview && (
        <div className="error-banner" role="alert">
          {marketError} Prices below may be stale. Paper trading is paused until fresh quotes
          return.
        </div>
      )}
      <div className="terminal-grid">
        {chartPart}
        <Book preview={preview} />
        {preview ? (
          <div className="preview-ticket">
            <div className="panel-heading">
              <h3>Your first trade starts here.</h3>
            </div>
            <p>
              A live view of 16 spot markets. Create your account, add virtual funds, and make your
              next move.
            </p>
            <Link href="/register" className="button primary full">
              Create account <ArrowUpRight size={16} />
            </Link>
            <div className="preview-fees">
              <span>Maker fee</span>
              <strong>{new Decimal(market?.makerFee || '0.001').mul(100).toFixed(2)}%</strong>
              <span>Taker fee</span>
              <strong>{new Decimal(market?.takerFee || '0.0015').mul(100).toFixed(2)}%</strong>
            </div>
            <span className="muted small-text">Example rates · virtual funds only</span>
          </div>
        ) : (
          <OrderTicket />
        )}
      </div>
      {!preview && (
        <>
          <details className="compact-book">
            <summary>
              Order book · indicative market depth <ChevronDown size={15} />
            </summary>
            <Book />
          </details>
          <div className="terminal-bottom">
            <div className="terminal-orders">
              <div className="tabs">
                {[
                  [
                    'open',
                    `Open orders (${account?.orders.filter((o) => o.status === 'OPEN').length || 0})`,
                  ],
                  ['history', 'Order history'],
                  ['trades', 'Trade history'],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setTab(key)}
                    className={tab === key ? 'active' : ''}
                  >
                    {label}
                  </button>
                ))}
                <Link href="/orders">
                  View all <ArrowUpRight size={13} />
                </Link>
              </div>
              <OrderTable
                orders={(account?.orders || [])
                  .filter((o) =>
                    tab === 'open'
                      ? o.status === 'OPEN'
                      : tab === 'trades'
                        ? o.status === 'FILLED'
                        : true,
                  )
                  .slice(0, 8)}
                compactView
                emptyText={
                  tab === 'open'
                    ? 'No open orders. Your next opportunity is waiting.'
                    : 'Your trading history will appear here.'
                }
              />
            </div>
            <section className="recent-trades">
              <div className="panel-heading">
                <h3>{market?.source === 'live' ? 'Binance trades' : 'Simulated trades'}</h3>
                <span className="status-dot" />
              </div>
              <div className="book-header">
                <span>Price (USDT)</span>
                <span>Amount</span>
                <span>Time</span>
              </div>
              {market?.trades.slice(0, 7).map((t, i) => (
                <div className="book-row" key={i}>
                  <span className={t.side === 'BUY' ? 'positive' : 'negative'}>
                    {fmt(t.price, digits)}
                  </span>
                  <span>{fmt(t.quantity, 5)}</span>
                  <span>{new Date(t.time).toLocaleTimeString('en-US', { hour12: false })}</span>
                </div>
              ))}
              {!market?.trades.length && (
                <p className="muted trades-empty">Waiting for the next market update…</p>
              )}
            </section>
          </div>
        </>
      )}
      <Modal
        open={pairOpen}
        onOpenChange={setPairOpen}
        title="Select a market"
        description="Search 16 spot markets, including Hyperliquid. Price sources are always explicit."
      >
        <SearchInput value={search} onChange={setSearch} />
        <div className="pair-list">
          {ASSETS.filter((a) =>
            (a.symbol + a.name).toLowerCase().includes(search.toLowerCase()),
          ).map((a) => (
            <Link
              key={a.symbol}
              href={`/trade/${a.symbol}-USDT`}
              onClick={() => {
                setSymbol(a.symbol);
                setPairOpen(false);
              }}
            >
              <Coin symbol={a.symbol} />
              <span>
                {a.symbol}/USDT<small>{a.name}</small>
              </span>
              <strong>
                {fmt(
                  market?.markets.find((m) => m.symbol === a.symbol)?.price,
                  priceDigits(a.symbol, market?.instruments[a.symbol]?.tickSize),
                )}
              </strong>
              <ArrowUpRight size={16} />
            </Link>
          ))}
        </div>
      </Modal>
      <Modal
        open={expanded}
        onOpenChange={setExpanded}
        title={`${symbol}/USDT chart`}
        description="Drag to pan, scroll to zoom. Prices follow the selected data source."
      >
        {market && (
          <Chart
            tickSize={market.instruments[symbol]?.tickSize}
            candles={market.candles}
            identity={symbol + timeframe + 'expanded'}
            height={450}
          />
        )}
      </Modal>
    </div>
  );
}
