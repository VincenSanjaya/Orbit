'use client';

import { useEffect, useState } from 'react';
import Decimal from 'decimal.js';
import type { Account } from '@/lib/shared';
import type { ExchangeRate } from '@/lib/exchange-rate';
import { fmt } from '@/lib/shared';
import { api } from './provider';

export function WalletTotalAssets({ account }: { account: Account }) {
  const preferenceKey = `orbit.wallet.currency.${account.user.id}`;
  const [currency, setCurrency] = useState<'USD' | 'IDR'>('USD');
  const [rate, setRate] = useState<ExchangeRate | null>(null);
  const [rateError, setRateError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    try {
      if (localStorage.getItem(preferenceKey) === 'IDR') setCurrency('IDR');
    } catch {
      /* Currency switching still works with storage disabled. */
    }
  }, [preferenceKey]);

  useEffect(() => {
    let stopped = false;
    const load = async () => {
      try {
        const next = await api<ExchangeRate>('exchange-rate');
        if (!stopped) {
          setRate(next);
          setRateError('');
        }
      } catch {
        if (!stopped) {
          setRate(null);
          setRateError('Rupiah rate unavailable.');
        }
      }
    };
    void load();
    const timer = setInterval(
      () => {
        if (!document.hidden) void load();
      },
      60 * 60 * 1000,
    );
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [attempt]);

  const amount =
    account.equity === null || (currency === 'IDR' && !rate)
      ? null
      : new Decimal(account.equity).mul(currency === 'IDR' ? rate!.rate : 1);
  const value =
    amount === null
      ? '—'
      : currency === 'USD'
        ? `$${fmt(amount.toString())}`
        : `Rp ${Number(amount.toFixed(0)).toLocaleString('id-ID')}`;

  return (
    <div className="wallet-total-assets">
      <div className="wallet-total-heading">
        <span className="muted">Total assets</span>
        <select
          aria-label="Total assets currency"
          value={currency}
          onChange={(event) => {
            const next = event.target.value === 'IDR' ? 'IDR' : 'USD';
            setCurrency(next);
            try {
              localStorage.setItem(preferenceKey, next);
            } catch {
              /* Optional preference. */
            }
          }}
        >
          <option value="USD">USD · US Dollar</option>
          <option value="IDR">IDR · Rupiah</option>
        </select>
      </div>
      <h2 aria-label="Total assets value">
        {value} <small>{currency}</small>
      </h2>
      <p>All holdings, including funds reserved in open orders</p>
      {account.equity === null && <p role="status">Waiting for fresh asset prices.</p>}
      {currency === 'IDR' && (
        <p className="wallet-rate" role="status">
          {rate ? (
            <>
              1 USD = Rp {Number(rate.rate).toLocaleString('id-ID')} ·{' '}
              <a href="https://frankfurter.dev/" target="_blank" rel="noreferrer">
                Frankfurter
              </a>{' '}
              · {rate.date}
              {rate.cached ? ' · Cached rate' : ' · Daily reference rate'}
            </>
          ) : rateError ? (
            <>
              {rateError}{' '}
              <button
                className="text-button"
                onClick={() => {
                  setRateError('');
                  setAttempt((n) => n + 1);
                }}
              >
                Retry
              </button>
            </>
          ) : (
            'Loading rupiah exchange rate…'
          )}
        </p>
      )}
      <p>Estimated display value · 1 USDT ≈ 1 USD</p>
      <div className="wallet-cash-summary">
        <span>
          Available USDT{' '}
          <strong>{fmt(account.balances.find((b) => b.asset === 'USDT')?.available)}</strong>
        </span>
        <span>
          Reserved USDT{' '}
          <strong>{fmt(account.balances.find((b) => b.asset === 'USDT')?.reserved)}</strong>
        </span>
      </div>
    </div>
  );
}
