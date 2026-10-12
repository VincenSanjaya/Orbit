'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ArrowUpRight,
  ArrowRight,
  Menu,
  X,
  LogOut,
  LayoutDashboard,
  Wallet,
  History,
  ListOrdered,
  Settings,
  Activity,
  Search,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useApp } from './provider';
import { ASSETS, type MarketMode } from '@/lib/shared';
export function Logo() {
  return (
    <Link href="/" className="brand" aria-label="ORBIT Exchange home">
      <svg width="29" height="29" viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <circle cx="16" cy="16" r="10.5" stroke="currentColor" strokeWidth="2.8" />
        <path d="M4 26 26 4" stroke="var(--accent)" strokeWidth="3" />
        <circle cx="27" cy="5" r="3" fill="var(--accent)" />
      </svg>
      <span>
        ORBIT<span className="brand-sub">EXCHANGE</span>
      </span>
    </Link>
  );
}
export function Header() {
  const path = usePathname(),
    landing = path === '/',
    { user, signOut } = useApp(),
    [open, setOpen] = useState(false);
  const links = landing
    ? [
        ['Markets', '/markets'],
        ['Exchange', '/trade/BTC-USDT'],
        ['Why ORBIT', '/#why-orbit'],
      ]
    : [
        ['Markets', '/markets'],
        ['Trade', '/trade/BTC-USDT'],
        ['Portfolio', '/portfolio'],
        ['Orders', '/orders'],
        ['Wallet', '/wallet'],
      ];
  return (
    <header className={`header ${landing ? 'landing-header' : ''}`}>
      <div className="header-inner">
        <Logo />
        <nav className="desktop-nav">
          {links.map(([name, href]) => (
            <Link
              key={href}
              href={href}
              className={
                !href.includes('#') && path.startsWith(href) && href !== '/' ? 'active' : ''
              }
            >
              {name}
            </Link>
          ))}
        </nav>
        <div className="header-actions">
          <span className="demo-badge">PAPER TRADING</span>
          {user ? (
            <>
              <Link href="/settings" className="avatar" title="Account settings">
                {user.name.slice(0, 1).toUpperCase()}
              </Link>
              <button className="icon-button logout" aria-label="Sign out" onClick={signOut}>
                <LogOut size={17} />
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className="login-link">
                Log in
              </Link>
              <Link className="button small primary" href="/register">
                Get started <ArrowUpRight size={15} />
              </Link>
            </>
          )}
          <button
            className="icon-button mobile-menu"
            aria-label={open ? 'Close navigation' : 'Open navigation'}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>
      {open && (
        <nav className="mobile-nav">
          {[...links, ['History', '/history'], ['Settings', '/settings']].map(([name, href]) => (
            <Link key={href} href={href} onClick={() => setOpen(false)}>
              {name}
              <ArrowUpRight size={15} />
            </Link>
          ))}
          {!user && (
            <Link href="/login" onClick={() => setOpen(false)}>
              Log in
            </Link>
          )}
        </nav>
      )}
    </header>
  );
}
export function Footer() {
  return (
    <footer className="footer">
      <Logo />
      <span>Practice with purpose. Trade with perspective.</span>
      <div>
        <span>© {new Date().getFullYear()} ORBIT Exchange</span>
        <Link href="/settings">
          Trading terms & fees <ArrowUpRight size={13} />
        </Link>
      </div>
    </footer>
  );
}
export function Coin({ symbol, size = 32 }: { symbol: string; size?: number }) {
  const asset = ASSETS.find((a) => a.symbol === symbol);
  return (
    <span
      className="coin"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.6,
        color: asset?.color || '#aaca8b',
        background: (asset?.color || '#aaca8b') + '16',
      }}
    >
      {asset?.mark || '₮'}
    </span>
  );
}
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content className="modal">
          <Dialog.Title className="modal-title">{title}</Dialog.Title>
          <Dialog.Description className="muted">
            {description || 'Review the details below before continuing.'}
          </Dialog.Description>
          <Dialog.Close className="modal-close icon-button" aria-label="Close dialog">
            <X size={20} />
          </Dialog.Close>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function SourceStatus() {
  const { market, marketError, mode, setMode, feedStatus } = useApp();
  return (
    <div className="source-status">
      <span
        className={`status-dot ${feedStatus === 'STALE' || feedStatus === 'UNAVAILABLE' ? 'error-dot' : ''}`}
      />
      <strong className={`feed-badge feed-${feedStatus.toLowerCase()}`}>{feedStatus}</strong>
      <span>
        {mode === 'live' ? 'Binance Spot · live market data' : 'ORBIT · simulated market data'}
      </span>
      {market && market.updatedAt > 0 && (
        <span className="freshness">
          Updated {new Date(market.updatedAt).toLocaleTimeString('en-US', { hour12: false })}
        </span>
      )}
      <select
        aria-label="Market data source"
        value={mode}
        onChange={(e) => setMode(e.target.value as MarketMode)}
      >
        <option value="live">Binance Live</option>
        <option value="simulated">Simulated</option>
      </select>
      {marketError && <span className="sr-only">{marketError}</span>}
    </div>
  );
}
const accountLinks = [
  ['Overview', '/portfolio', LayoutDashboard],
  ['Orders', '/orders', ListOrdered],
  ['Transactions', '/history', History],
  ['Wallet', '/wallet', Wallet],
  ['Settings', '/settings', Settings],
] as const;
export function AccountShell({ children }: { children: ReactNode }) {
  const path = usePathname(),
    { authReady, user } = useApp();
  return (
    <div className="account-layout">
      <aside className="sidebar">
        <span className="eyebrow">YOUR WORKSPACE</span>
        {accountLinks.map(([name, href, Icon]) => (
          <Link href={href} key={href} className={path === href ? 'active' : ''}>
            <Icon size={18} />
            {name}
            {path === href && <span className="nav-dot" />}
          </Link>
        ))}
        <div className="sidebar-note">
          <Activity size={19} />
          <strong>A space to get better.</strong>
          <p>
            Virtual funds. Real practice.
            <br />
            Your next move is yours.
          </p>
          <Link href="/trade/BTC-USDT">
            Open terminal <ArrowUpRight size={14} />
          </Link>
        </div>
      </aside>
      <main className="account-main">
        {!authReady ? (
          <div className="skeleton tall" />
        ) : !user ? (
          <Empty
            icon={<Wallet />}
            title="Your workspace awaits"
            description="Sign in to manage your virtual portfolio, orders, and wallet."
            action={
              <Link href="/login" className="button primary">
                Sign in <ArrowRight size={16} />
              </Link>
            }
          />
        ) : (
          children
        )}
      </main>
    </div>
  );
}
export function Empty({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function SearchInput({
  value,
  onChange,
  placeholder = 'Search assets…',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="search-input">
      <Search size={16} />
      <input
        aria-label={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}
export function PageTitle({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-title">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
export function Sparkline({ values, positive = true }: { values: string[]; positive?: boolean }) {
  if (values.length < 2) return <span className="muted">—</span>;
  const nums = values.map(Number),
    min = Math.min(...nums),
    range = Math.max(...nums) - min || 1;
  const points = nums
    .map((v, i) => `${(i * 100) / (nums.length - 1)},${30 - ((v - min) * 25) / range}`)
    .join(' ');
  return (
    <svg className="sparkline" viewBox="0 0 100 35" aria-label="Price trend" role="img">
      <polyline
        points={points}
        fill="none"
        stroke={positive ? 'var(--green)' : 'var(--red)'}
        strokeWidth="1.8"
      />
    </svg>
  );
}
