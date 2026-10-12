'use client';
import { useState } from 'react';
import Link from 'next/link';
import Decimal from 'decimal.js';
import {
  ArrowUpRight,
  Plus,
  RotateCcw,
  ArrowRight,
  ShieldCheck,
  LogOut,
  Info,
  ChartNoAxesCombined,
  ReceiptText,
} from 'lucide-react';
import { ASSETS, fmt, date, priceDigits } from '@/lib/shared';
import { api, useApp } from './provider';
import { AccountShell, PageTitle, Coin, Empty, Modal, SourceStatus } from './ui';
import { OrderTable, HistoryTable, Filters } from './tables';
import { WalletTotalAssets } from './wallet-total-assets';
function Stat({
  label,
  value,
  sub,
  positive,
}: {
  label: string;
  value: string;
  sub: string;
  positive?: boolean;
}) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong className={positive === undefined ? '' : positive ? 'positive' : 'negative'}>
        {value}
      </strong>
      <small>{sub}</small>
    </div>
  );
}
function Holdings({ wallet = false }: { wallet?: boolean }) {
  const { account } = useApp();
  if (!account) return <div className="skeleton tall" />;
  return (
    <div className="table-scroll">
      <table className="data-table holdings-table">
        <thead>
          <tr>
            <th>Asset</th>
            <th>Available</th>
            <th>Reserved</th>
            <th>Value (USDT)</th>
            {!wallet && (
              <>
                <th>Avg. cost (USDT)</th>
                <th>Unrealized P&L</th>
              </>
            )}
            <th></th>
          </tr>
        </thead>
        <tbody>
          {[...account.balances]
            .sort((a, b) => Number(b.value) - Number(a.value))
            .filter(
              (b) =>
                wallet || Number(b.value) > 0 || new Decimal(b.available).add(b.reserved).gt(0),
            )
            .map((b) => (
              <tr key={b.asset}>
                <td>
                  <div className="asset-cell">
                    <Coin symbol={b.asset} />
                    <div>
                      <strong>{b.asset}</strong>
                      <small>
                        {ASSETS.find((a) => a.symbol === b.asset)?.name || 'Virtual Tether'}
                      </small>
                    </div>
                  </div>
                </td>
                <td>{fmt(b.available, b.asset === 'USDT' ? 2 : 5)}</td>
                <td>{fmt(b.reserved, b.asset === 'USDT' ? 2 : 5)}</td>
                <td>{fmt(b.value)}</td>
                {!wallet && (
                  <>
                    <td>{b.asset === 'USDT' ? '—' : fmt(b.averageCost, priceDigits(b.asset))}</td>
                    <td className={Number(b.unrealized) >= 0 ? 'positive' : 'negative'}>
                      {b.asset === 'USDT'
                        ? '—'
                        : `${Number(b.unrealized) >= 0 ? '+' : ''}${fmt(b.unrealized)}`}
                    </td>
                  </>
                )}
                <td>
                  <Link
                    className="icon-button"
                    aria-label={b.asset === 'USDT' ? 'Open wallet' : `Trade ${b.asset}`}
                    href={b.asset === 'USDT' ? '/wallet' : `/trade/${b.asset}-USDT`}
                  >
                    <ArrowUpRight size={16} />
                  </Link>
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
function Performance() {
  const { account } = useApp(),
    points = account?.performance || [],
    values = points.map((p) => Number(p.equity));
  const min = Math.min(...values) * 0.999,
    max = Math.max(...values) * 1.001,
    range = max - min || 1;
  const coords = values
    .map(
      (v, i) => `${(i * 1000) / Math.max(1, values.length - 1)},${155 - ((v - min) * 145) / range}`,
    )
    .join(' ');
  return (
    <section className="panel performance-panel">
      <div className="panel-heading">
        <h3>Portfolio performance</h3>
        <span className="muted small-text">Current market mode · USDT</span>
      </div>
      {points.length < 2 ? (
        <Empty
          icon={<ChartNoAxesCombined size={22} />}
          title="Your progress starts here"
          description="Equity snapshots are saved each minute while your account is open. Your history will build over time."
        />
      ) : (
        <>
          <div className="performance-chart">
            <span className="chart-value">{fmt(max)}</span>
            <svg
              viewBox="0 0 1000 170"
              preserveAspectRatio="none"
              role="img"
              aria-label="Recorded portfolio equity over time"
            >
              <line x1="0" x2="1000" y1="40" y2="40" stroke="#ffffff0a" />
              <line x1="0" x2="1000" y1="100" y2="100" stroke="#ffffff0a" />
              <polyline
                points={coords}
                fill="none"
                stroke="var(--accent)"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            <span className="chart-value">{fmt(min)}</span>
          </div>
          <div className="performance-dates">
            <span>{date(points[0].time * 1000)}</span>
            <span>{date(points.at(-1)!.time * 1000)}</span>
          </div>
        </>
      )}
    </section>
  );
}
function Allocation() {
  const { account } = useApp();
  if (!account) return null;
  if (account.equity === null)
    return (
      <section className="panel allocation-panel">
        <div className="panel-heading">
          <h3>Asset allocation</h3>
        </div>
        <Empty
          icon={<ChartNoAxesCombined />}
          title="Waiting for fresh quotes"
          description="Your asset quantities remain intact. Allocation resumes when the Binance feed is valid."
        />
      </section>
    );
  const holdings = account.balances
    .filter((b) => Number(b.value) > 0)
    .sort((a, b) => Number(b.value) - Number(a.value));
  const stops = holdings
    .map((b, i) => {
      const start =
        (holdings.slice(0, i).reduce((s, h) => s + Number(h.value), 0) / Number(account.equity)) *
        100;
      const end = start + (Number(b.value) / Number(account.equity)) * 100;
      const color = ASSETS.find((a) => a.symbol === b.asset)?.color || '#b9da83';
      return `${color} ${start}% ${end}%`;
    })
    .join(',');
  return (
    <section className="panel allocation-panel">
      <div className="panel-heading">
        <h3>Asset allocation</h3>
        <span className="muted small-text">By current value</span>
      </div>
      <div className="allocation-body">
        <div
          className="allocation-ring"
          style={{ background: `conic-gradient(${stops || '#252a28 0% 100%'})` }}
        >
          <div>
            <strong>{holdings.length}</strong>
            <span>assets held</span>
          </div>
        </div>
        <div className="allocation-list">
          {holdings.map((b) => (
            <div key={b.asset}>
              <span>
                <i
                  style={{
                    background: ASSETS.find((a) => a.symbol === b.asset)?.color || '#b9da83',
                  }}
                />
                {b.asset}
              </span>
              <strong>
                {Number(account.equity) > 0
                  ? fmt(
                      new Decimal(b.value || 0)
                        .div(account.equity || 1)
                        .mul(100)
                        .toString(),
                      1,
                    )
                  : '0'}
                %
              </strong>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
export function Portfolio() {
  const { account, user } = useApp();
  const totalPnl = account
    ? new Decimal(account.realized).add(account.unrealized || 0)
    : new Decimal(0);
  return (
    <AccountShell>
      <PageTitle
        eyebrow="YOUR PORTFOLIO"
        title={`A little perspective, ${user?.name.split(' ')[0] || 'trader'}.`}
        description="Every decision adds up. Here’s where you stand."
        action={
          <Link className="button primary" href="/trade/BTC-USDT">
            Make a move <ArrowUpRight size={16} />
          </Link>
        }
      />
      <SourceStatus />
      {account?.equity === null && (
        <div className="error-banner" role="alert">
          Live valuation is unavailable. Your holdings and cost basis are preserved; no substitute
          prices are used.
        </div>
      )}
      <div className="stats-row">
        <Stat
          label="Total equity"
          value={`${fmt(account?.equity)} USDT`}
          sub={
            account?.equity === null
              ? 'Valuation paused · waiting for fresh quotes'
              : account?.marketMode === 'live'
                ? 'Valued at validated Binance Spot prices'
                : 'Valued at simulated market prices'
          }
        />
        <Stat
          label="Unrealized P&L"
          value={`${Number(account?.unrealized) >= 0 ? '+' : ''}${fmt(account?.unrealized)} USDT`}
          positive={Number(account?.unrealized) >= 0}
          sub="Mark-to-market, including acquisition fees"
        />
        <Stat
          label="Realized P&L"
          value={`${Number(account?.realized) >= 0 ? '+' : ''}${fmt(account?.realized)} USDT`}
          positive={Number(account?.realized) >= 0}
          sub="Sold positions, after all fees"
        />
      </div>
      <div className="portfolio-chart-grid">
        <Performance />
        <Allocation />
      </div>
      <section className="panel">
        <div className="panel-heading">
          <h3>Your holdings</h3>
          <Link href="/wallet">
            Manage wallet <ArrowUpRight size={14} />
          </Link>
        </div>
        <Holdings />
      </section>
      <div className="portfolio-notes">
        <span>
          <Info size={14} /> Total trading P&L:{' '}
          <strong className={totalPnl.gte(0) ? 'positive' : 'negative'}>
            {totalPnl.gte(0) ? '+' : ''}
            {fmt(totalPnl.toString())} USDT
          </strong>
        </span>
        <span>Net virtual funding: {fmt(account?.netDeposits)} USDT</span>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <h3>Recent activity</h3>
          <Link href="/orders">
            All orders <ArrowUpRight size={14} />
          </Link>
        </div>
        <OrderTable orders={account?.orders.slice(0, 5) || []} compactView />
      </section>
    </AccountShell>
  );
}
function useFilters() {
  const [asset, setAsset] = useState(''),
    [side, setSide] = useState(''),
    [status, setStatus] = useState(''),
    [from, setFrom] = useState(''),
    [to, setTo] = useState('');
  return { asset, setAsset, side, setSide, status, setStatus, from, setFrom, to, setTo };
}
const dateMatch = (timestamp: number, from: string, to: string) =>
  (!from || timestamp >= new Date(from + 'T00:00:00').getTime()) &&
  (!to || timestamp <= new Date(to + 'T23:59:59.999').getTime());
export function Orders() {
  const { account } = useApp(),
    filters = useFilters(),
    [tab, setTab] = useState('all');
  const orders = (account?.orders || []).filter(
    (o) =>
      (!filters.asset || o.symbol === filters.asset) &&
      (!filters.side || o.side === filters.side) &&
      (!filters.status || o.status === filters.status) &&
      dateMatch(o.created_at, filters.from, filters.to) &&
      (tab !== 'open' || o.status === 'OPEN'),
  );
  return (
    <AccountShell>
      <PageTitle
        eyebrow="YOUR EXECUTION RECORD"
        title="Every move, accounted for."
        description="Inspect your orders, track fills, and manage what’s still open."
        action={
          <Link className="button secondary" href="/trade/BTC-USDT">
            New order <Plus size={16} />
          </Link>
        }
      />
      <section className="panel">
        <div className="tabs padded-tabs">
          <button className={tab === 'all' ? 'active' : ''} onClick={() => setTab('all')}>
            All orders ({account?.orders.length || 0})
          </button>
          <button className={tab === 'open' ? 'active' : ''} onClick={() => setTab('open')}>
            Open orders ({account?.orders.filter((o) => o.status === 'OPEN').length || 0})
          </button>
        </div>
        <Filters {...filters} />
        <OrderTable orders={orders} />
      </section>
      <p className="market-footnote">
        All-or-nothing fills. No partial execution. Canceled orders cannot execute. Rejected orders
        retain their rejection reason.
      </p>
    </AccountShell>
  );
}
export function History() {
  const { account } = useApp(),
    filters = useFilters(),
    [tab, setTab] = useState('ledger');
  return (
    <AccountShell>
      <PageTitle
        eyebrow="YOUR AUDIT TRAIL"
        title="Nothing lost in the details."
        description="An immutable record of funding, fees, fills, reserves, and resets."
      />
      <section className="panel">
        <div className="tabs padded-tabs">
          <button className={tab === 'ledger' ? 'active' : ''} onClick={() => setTab('ledger')}>
            Wallet ledger
          </button>
          <button className={tab === 'fills' ? 'active' : ''} onClick={() => setTab('fills')}>
            Executions & fees
          </button>
        </div>
        <Filters {...filters} history={tab === 'ledger'} />
        {tab === 'ledger' ? (
          <HistoryTable
            ledger={(account?.ledger || []).filter(
              (l) =>
                (!filters.asset || l.asset === filters.asset) &&
                dateMatch(l.created_at, filters.from, filters.to),
            )}
          />
        ) : (
          <OrderTable
            orders={(account?.orders || []).filter(
              (o) =>
                o.status === 'FILLED' &&
                (!filters.status || o.status === filters.status) &&
                (!filters.asset || o.symbol === filters.asset) &&
                (!filters.side || o.side === filters.side) &&
                dateMatch(o.created_at, filters.from, filters.to),
            )}
          />
        )}
      </section>
      <div className="info-note">
        <ReceiptText size={17} />
        <p>
          Settlement entries include the actual fee in the USDT balance change. Open{' '}
          <strong>Executions & fees</strong> to see the separate fee amount for each filled order.
        </p>
      </div>
    </AccountShell>
  );
}
export function WalletPage() {
  const { account, refresh, toast } = useApp(),
    [reset, setReset] = useState(false),
    [confirm, setConfirm] = useState(''),
    [busy, setBusy] = useState(false),
    [deposit, setDeposit] = useState(false);
  const action = async (kind: 'faucet' | 'reset') => {
    setBusy(true);
    try {
      await api('wallet/' + kind, kind === 'reset' ? { confirm } : {});
      await refresh();
      toast(
        kind === 'reset'
          ? 'Account restored to its opening balance. History preserved.'
          : '1,000 virtual USDT added to your wallet.',
      );
      setReset(false);
      setDeposit(false);
      setConfirm('');
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AccountShell>
      <PageTitle
        eyebrow="VIRTUAL FUNDS. REAL PRACTICE."
        title="Your practice capital."
        description="Fund your next idea. Keep your real money out of it."
        action={
          <span className="demo-badge">
            {account?.marketMode === 'live' ? 'LIVE MARKET ACCOUNT' : 'SIMULATED MARKET ACCOUNT'}
          </span>
        }
      />
      <div className="wallet-hero">
        {account ? (
          <WalletTotalAssets key={account.user.id} account={account} />
        ) : (
          <div className="skeleton" />
        )}
        <div className="wallet-actions">
          <button className="button primary" onClick={() => setDeposit(true)}>
            <Plus size={16} /> Deposit
          </button>
          <button className="button secondary" onClick={() => setReset(true)}>
            <RotateCcw size={15} /> Reset paper balances
          </button>
        </div>
      </div>
      <div className="info-note">
        <ShieldCheck size={19} />
        <p>
          This wallet holds simulation funds only. They have no monetary value and cannot be
          withdrawn, transferred, or deposited on a blockchain.
        </p>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <h3>Asset balances</h3>
          <span className="muted small-text">Available + reserved = total holdings</span>
        </div>
        <Holdings wallet />
      </section>
      <section className="panel">
        <div className="panel-heading">
          <h3>Funding history</h3>
          <Link href="/history">
            Full ledger <ArrowUpRight size={14} />
          </Link>
        </div>
        <HistoryTable
          ledger={(account?.ledger || [])
            .filter(
              (l) =>
                [
                  'INITIAL_FUNDING',
                  'FAUCET',
                  'RESET_FUNDING',
                  'RESET_CLEAR',
                  'ACCOUNT_ADJUSTMENT',
                ].includes(l.kind) && Number(l.available_delta) !== 0,
            )
            .slice(0, 10)}
        />
      </section>
      <Modal
        open={deposit}
        onOpenChange={setDeposit}
        title="A little more room to practice"
        description="Add 1,000 virtual USDT to your paper wallet. The faucet is available once per minute."
      >
        <div className="faucet-amount">
          +1,000 <span>virtual USDT</span>
        </div>
        <button className="button primary full" onClick={() => action('faucet')} disabled={busy}>
          {busy ? 'Adding funds…' : 'Add 1,000 virtual USDT'}
        </button>
      </Modal>
      <Modal
        open={reset}
        onOpenChange={setReset}
        title="Start with a clean slate?"
        description={`This cancels open orders, clears holdings and cost basis, resets P&L, and restores your opening balance of ${fmt(account?.openingFunds)} USDT. History stays intact.`}
      >
        <label className="form-label reset-label">
          Type RESET to confirm
          <input
            autoComplete="off"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="RESET"
          />
        </label>
        <button
          className="button danger full"
          disabled={confirm !== 'RESET' || busy}
          onClick={() => action('reset')}
        >
          {busy ? 'Resetting…' : 'Reset paper balances'}
        </button>
      </Modal>
    </AccountShell>
  );
}
export function SettingsPage() {
  const { account, user, signOut, market } = useApp();
  return (
    <AccountShell>
      <PageTitle
        eyebrow="YOUR ACCOUNT"
        title="Your orbit, your terms."
        description="Account details, session security, and a clear view of the rules."
      />
      <section className="panel settings-section">
        <div className="panel-heading">
          <h3>Profile</h3>
          <span className="demo-badge">
            {account?.marketMode === 'live' ? 'LIVE MARKET ACCOUNT' : 'SIMULATED MARKET ACCOUNT'}
          </span>
        </div>
        <div className="settings-fields">
          <div>
            <span>Name</span>
            <strong>{user?.name}</strong>
          </div>
          <div>
            <span>Email</span>
            <strong className="break-text">{user?.email}</strong>
          </div>
          <div>
            <span>Member since</span>
            <strong>{account ? date(account.user.created_at) : '—'}</strong>
          </div>
          <div>
            <span>Session</span>
            <strong>7-day persistent · HttpOnly cookie</strong>
          </div>
        </div>
        <div className="settings-action">
          <p>Your password is securely hashed. Your account data is private to your session.</p>
          <button className="button secondary" onClick={signOut}>
            Sign out <LogOut size={16} />
          </button>
        </div>
      </section>
      <section className="panel settings-section" id="fees">
        <div className="panel-heading">
          <h3>Transparent paper fees</h3>
          <ShieldCheck size={18} />
        </div>
        <div className="fee-grid">
          <div>
            <span>Maker · limit orders</span>
            <strong>{new Decimal(market?.makerFee || '0.001').mul(100).toFixed(2)}%</strong>
          </div>
          <div>
            <span>Taker · market orders</span>
            <strong>{new Decimal(market?.takerFee || '0.0015').mul(100).toFixed(2)}%</strong>
          </div>
        </div>
        <div className="fee-explanation">
          <p>
            <strong>Buying:</strong> you receive the full base quantity. We debit the purchase value
            plus the fee from USDT. The fee is included in acquisition cost.
          </p>
          <p>
            <strong>Selling:</strong> we debit the base quantity and credit the sale value minus the
            fee in USDT. Realized P&L uses weighted average cost, including acquisition fees.
          </p>
          <p>
            <strong>Limit orders:</strong> buys reserve limit value plus the maker fee. Sells
            reserve base quantity. A fill at a better price releases unused quote reserve.
          </p>
          <p>These are configurable demo rates. They do not describe a real exchange’s pricing.</p>
        </div>
      </section>
      <section className="panel settings-section">
        <div className="panel-heading">
          <h3>How this exchange works</h3>
          <Info size={18} />
        </div>
        <div className="fee-explanation">
          <p>
            ORBIT is a virtual spot trading simulator. There are no real-money deposits,
            withdrawals, leverage, futures, or financial custody.
          </p>
          <p>
            Paper orders execute in full at the latest validated server quote, with configured
            slippage. Live limits trigger against fresh Binance quotes; simulated limits retain
            their simulated source. Every limit uses the demo maker rate, even if it crosses
            immediately. The indicative book does not determine execution.
          </p>
          <p>
            The simulated price process pauses while the server and worker are stopped. Requests
            advance the market when the app is active; run the optional market worker to process
            pending orders when no browser is open. No synthetic ticks are replayed for downtime.
          </p>
          <p>
            Binance Live and Simulated modes are explicit. Account valuations follow your selected
            mode. Existing orders keep their original source after a mode change. If the live feed
            disconnects, fills pause; missed crossings during downtime are never replayed.
          </p>
        </div>
        <Link className="button secondary" href="/wallet">
          Manage your virtual funds <ArrowRight size={16} />
        </Link>
      </section>
    </AccountShell>
  );
}
