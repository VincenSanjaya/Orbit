'use client';
import Link from 'next/link';
import {
  ArrowUpRight,
  ArrowRight,
  ChartCandlestick,
  ShieldCheck,
  ScanLine,
  MoveUpRight,
  Check,
  Plus,
} from 'lucide-react';
import { useApp } from './provider';
import { Coin, Sparkline, Footer } from './ui';
import { TradingTerminal } from './terminal';
import { ASSETS, fmt } from '@/lib/shared';
import { useState } from 'react';
const faqs = [
  [
    'Is this a real cryptocurrency exchange?',
    'ORBIT is a paper trading simulator. Every balance, order, and fill is virtual. You cannot deposit, withdraw, or trade real money.',
  ],
  [
    'How do simulated orders execute?',
    'Paper market orders fill at the fresh server quote with configurable slippage. Limits reserve funds and trigger against their original live or simulated source. Real market depth is informational, not an execution guarantee.',
  ],
  [
    'What does it cost to practice?',
    'Every new account starts at zero. Demo maker fees are 0.10% and taker fees are 0.15%, paid in USDT. Add virtual funds with the faucet or reset your account any time.',
  ],
  [
    'Can I explore public market data?',
    'Choose Binance Live for genuine spot quotes, candles, trades, and depth. Paper fills use fresh server quotes. Simulated mode is separately labeled and never selected automatically.',
  ],
];
export default function Landing() {
  const { market } = useApp(),
    [faq, setFaq] = useState<number | null>(0);
  return (
    <>
      <main className="landing">
        <section className="hero">
          <div className="hero-topline">
            <span className="eyebrow">
              <span className="status-dot" /> A BETTER SPACE TO TRADE
            </span>
            <span className="hero-edition">SPOT MARKETS / ZERO REAL-MONEY RISK</span>
          </div>
          <div className="hero-main">
            <div>
              <h1>
                Find your edge.
                <br />
                <span>Make your move.</span>
              </h1>
              <p>
                A clearer view of the markets. A sharper sense of your next move.
                <br className="desktop-break" /> Your trading journey starts with practice, not
                pressure.
              </p>
              <div className="hero-actions">
                <Link href="/trade/BTC-USDT" className="button primary">
                  Launch exchange <ArrowUpRight size={18} />
                </Link>
                <Link href="/markets" className="button text-link">
                  Explore markets <ArrowRight size={17} />
                </Link>
              </div>
              <div className="hero-assurance">
                <span>
                  <Check size={13} /> Live Binance market data
                </span>
                <span>
                  <Check size={13} /> No card. No real funds.
                </span>
              </div>
            </div>
            <div className="hero-side">
              <div className="hero-index">01 — THE ORBIT APPROACH</div>
              <p>
                Less noise.
                <br />
                More perspective.
              </p>
              <span>
                Everything you need to practice.
                <br />
                Nothing between you and the market.
              </span>
              <div className="hero-side-line" />
              <MoveUpRight size={38} strokeWidth={1} />
            </div>
          </div>
        </section>
        <TradingTerminal preview />
        <div className="preview-caption">
          <span>
            <i className="status-dot" /> YOUR TERMINAL. YOUR PERSPECTIVE.
          </span>
          <span>
            {market?.source === 'simulated' ? 'Simulated' : 'Binance live'} market preview · paper
            trading · virtual funds only
          </span>
        </div>
        <section className="market-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">THE MARKET, AT A GLANCE</span>
              <h2>Opportunity never stands still.</h2>
            </div>
            <Link href="/markets">
              Explore all markets <ArrowUpRight size={16} />
            </Link>
          </div>
          <div className="market-strip">
            {ASSETS.slice(0, 4).map((a) => {
              const m = market?.markets.find((m) => m.symbol === a.symbol);
              return (
                <Link href={`/trade/${a.symbol}-USDT`} className="market-strip-item" key={a.symbol}>
                  <div>
                    <Coin symbol={a.symbol} size={27} />
                    <strong>
                      {a.symbol}
                      <span className="muted"> / USDT</span>
                    </strong>
                    <ArrowUpRight size={15} />
                  </div>
                  <strong className="market-strip-price">${m ? fmt(m.price) : '—'}</strong>
                  <div>
                    <span className={Number(m?.change) >= 0 ? 'positive' : 'negative'}>
                      {Number(m?.change) >= 0 ? '+' : ''}
                      {fmt(m?.change)}%
                    </span>
                    <Sparkline values={m?.spark || []} positive={Number(m?.change) >= 0} />
                  </div>
                </Link>
              );
            })}
          </div>
          <p className="market-footnote">
            24h performance from the selected source. Binance Live and Simulated modes never switch
            silently.
          </p>
        </section>
        <section id="why-orbit" className="why-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">BUILT FOR THE WAY YOU THINK</span>
              <h2>
                Serious tools.
                <br />
                <span className="muted">Room to learn.</span>
              </h2>
            </div>
            <p>
              A focused environment for building confidence.
              <br />
              From your first order to a strategy of your own.
            </p>
          </div>
          <div className="feature-grid">
            <article>
              <ChartCandlestick size={27} strokeWidth={1.4} />
              <span className="feature-index">01 / PERSPECTIVE</span>
              <h3>
                The full picture,
                <br />
                without the clutter.
              </h3>
              <p>
                Interactive candles, volume, market depth, and a precise order ticket. A terminal
                that puts your decisions first.
              </p>
              <Link href="/trade/BTC-USDT">
                Meet your terminal <ArrowUpRight size={15} />
              </Link>
            </article>
            <article>
              <ShieldCheck size={27} strokeWidth={1.4} />
              <span className="feature-index">02 / PRACTICE</span>
              <h3>
                Real decisions.
                <br />
                Virtual stakes.
              </h3>
              <p>
                Start with a zero-balance account. Practice market and limit orders, see fees
                upfront, and reset when you need a fresh start.
              </p>
              <Link href="/register">
                Start practicing <ArrowUpRight size={15} />
              </Link>
            </article>
            <article>
              <ScanLine size={27} strokeWidth={1.4} />
              <span className="feature-index">03 / PROGRESS</span>
              <h3>
                Know where
                <br />
                you stand.
              </h3>
              <p>
                Follow your allocation, cost basis, and profit and loss. Every order and balance
                change leaves a clear, persistent record.
              </p>
              <Link href="/portfolio">
                See your portfolio <ArrowUpRight size={15} />
              </Link>
            </article>
          </div>
        </section>
        <section className="faq-section">
          <div>
            <span className="eyebrow">A LITTLE CLARITY</span>
            <h2>
              Before you
              <br />
              make your move.
            </h2>
            <p className="muted">Straight answers. No fine print surprises.</p>
          </div>
          <div className="faq-list">
            {faqs.map(([q, a], i) => (
              <div className="faq-item" key={q}>
                <button
                  onClick={() => setFaq(faq === i ? null : i)}
                  aria-expanded={faq === i}
                  aria-controls={`faq-${i}`}
                >
                  {q}
                  <Plus size={18} style={{ transform: faq === i ? 'rotate(45deg)' : 'none' }} />
                </button>
                {faq === i && <p id={`faq-${i}`}>{a}</p>}
              </div>
            ))}
          </div>
        </section>
        <section className="closing-cta">
          <span className="eyebrow">YOUR NEXT CHAPTER</span>
          <div>
            <h2>
              The market moves.
              <br />
              Move with intention.
            </h2>
            <Link className="button primary" href="/register">
              Create your account <ArrowUpRight size={18} />
            </Link>
          </div>
          <p>Live Binance market data. Sixteen spot markets. One place to find your edge.</p>
        </section>
      </main>
      <Footer />
    </>
  );
}
