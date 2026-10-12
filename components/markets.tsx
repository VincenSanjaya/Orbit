'use client';
import { useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Star, TrendingUp, ChartNoAxesCombined, Activity } from 'lucide-react';
import { useApp } from './provider';
import { Coin, Sparkline, SearchInput, SourceStatus, PageTitle } from './ui';
import { ASSETS, fmt, compact, priceDigits } from '@/lib/shared';
export default function Markets() {
  const { market, marketError, favorites, toggleFavorite } = useApp(),
    [search, setSearch] = useState(''),
    [tab, setTab] = useState('all'),
    [sort, setSort] = useState('symbol');
  const markets = (market?.markets || [])
    .filter(
      (m) =>
        (m.symbol + m.name).toLowerCase().includes(search.toLowerCase()) &&
        (tab !== 'favorites' || favorites.includes(m.symbol)),
    )
    .sort((a, b) =>
      sort === 'change' || tab === 'movers'
        ? Number(b.change) - Number(a.change)
        : sort === 'volume' || tab === 'trending'
          ? Number(b.volume) - Number(a.volume)
          : 0,
    );
  const best = [...(market?.markets || [])]
    .filter((m) => m.price !== null)
    .sort((a, b) => Number(b.change) - Number(a.change))[0];
  return (
    <main className="markets-page">
      <PageTitle
        eyebrow="SIXTEEN MARKETS. A WORLD OF POSSIBILITIES."
        title="A clearer view of the market."
        description="Find your next opportunity. Build your own perspective."
        action={
          <Link className="button secondary" href="/trade/BTC-USDT">
            Open terminal <ArrowUpRight size={16} />
          </Link>
        }
      />
      <div className="market-overview">
        <div>
          <span>
            <ChartNoAxesCombined size={17} /> Available markets
          </span>
          <strong>
            {String(ASSETS.length).padStart(2, '0')} <small>spot pairs</small>
          </strong>
          <p>All quoted in USDT</p>
        </div>
        <div>
          <span>
            <TrendingUp size={17} /> Leading performer · 24h
          </span>
          <strong>
            {best?.symbol || '—'}{' '}
            <small className={Number(best?.change) >= 0 ? 'positive' : 'negative'}>
              {Number(best?.change) >= 0 ? '+' : ''}
              {fmt(best?.change)}%
            </small>
          </strong>
          <p>From the selected data source</p>
        </div>
        <div>
          <span>
            <Activity size={17} /> Trading environment
          </span>
          <strong>
            Paper <small>by design</small>
          </strong>
          <p>Practice with virtual funds</p>
        </div>
      </div>
      <SourceStatus />
      {marketError && (
        <div role="alert" className="error-banner">
          {marketError}
        </div>
      )}
      <section className="panel markets-panel">
        <div className="market-controls">
          <div className="tabs">
            <button className={tab === 'all' ? 'active' : ''} onClick={() => setTab('all')}>
              All markets
            </button>
            <button
              className={tab === 'favorites' ? 'active' : ''}
              onClick={() => setTab('favorites')}
            >
              <Star size={14} /> Watchlist
            </button>
            <button className={tab === 'movers' ? 'active' : ''} onClick={() => setTab('movers')}>
              24h movers
            </button>
            <button
              className={tab === 'trending' ? 'active' : ''}
              onClick={() => setTab('trending')}
            >
              Trending by volume
            </button>
          </div>
          <div className="sr-only">
            Trending markets are ranked by sourced 24h quote volume. Movers use sourced 24h price
            change.
          </div>
          <div className="market-controls-right">
            <select
              aria-label="Sort markets"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="symbol">Default order</option>
              <option value="change">24h change</option>
              <option value="volume">24h volume</option>
            </select>
            <SearchInput value={search} onChange={setSearch} />
          </div>
        </div>
        <div className="table-scroll">
          <table className="data-table market-table">
            <thead>
              <tr>
                <th>Asset</th>
                <th>Last price</th>
                <th>24h change</th>
                <th>24h high / low</th>
                <th>24h volume (USDT)</th>
                <th>24h trend</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {markets.map((m) => (
                <tr key={m.symbol}>
                  <td>
                    <div className="asset-cell">
                      <button
                        className={`icon-button ${favorites.includes(m.symbol) ? 'starred' : ''}`}
                        aria-label={`${favorites.includes(m.symbol) ? 'Remove' : 'Add'} ${m.symbol} ${favorites.includes(m.symbol) ? 'from' : 'to'} watchlist`}
                        onClick={() => toggleFavorite(m.symbol)}
                      >
                        <Star size={15} />
                      </button>
                      <Link className="asset-identity" href={`/trade/${m.symbol}-USDT`}>
                        <Coin symbol={m.symbol} />
                        <div>
                          <strong>
                            {m.symbol}
                            <span className="muted"> / USDT</span>
                          </strong>
                          <small>
                            {m.name}
                            {m.status === 'UNSUPPORTED'
                              ? ' · unavailable'
                              : m.status === 'STALE'
                                ? ' · stale'
                                : ''}
                          </small>
                        </div>
                      </Link>
                    </div>
                  </td>
                  <td>
                    <strong>
                      $
                      {fmt(m.price, priceDigits(m.symbol, market?.instruments[m.symbol]?.tickSize))}
                    </strong>
                  </td>
                  <td className={Number(m.change) >= 0 ? 'positive' : 'negative'}>
                    {Number(m.change) >= 0 ? '+' : ''}
                    {fmt(m.change)}%
                  </td>
                  <td>
                    {fmt(m.high, priceDigits(m.symbol, market?.instruments[m.symbol]?.tickSize))}
                    <small>
                      {fmt(m.low, priceDigits(m.symbol, market?.instruments[m.symbol]?.tickSize))}
                    </small>
                  </td>
                  <td>{compact(m.volume)}</td>
                  <td>
                    <Sparkline values={m.spark} positive={Number(m.change) >= 0} />
                  </td>
                  <td>
                    <Link className="button small secondary" href={`/trade/${m.symbol}-USDT`}>
                      Trade <ArrowUpRight size={13} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!market && !marketError && <div className="skeleton tall" />}
          {market && !markets.length && (
            <div className="empty">
              <h3>No matching markets</h3>
              <p>
                {tab === 'favorites'
                  ? 'Use the star beside an asset to build your watchlist.'
                  : 'Try a different name or symbol.'}
              </p>
            </div>
          )}
        </div>
      </section>
      <p className="market-footnote">
        Prices, paper execution, and portfolio values share the selected market source. Binance
        quotes are informational; ORBIT never sends exchange orders.
      </p>
    </main>
  );
}
