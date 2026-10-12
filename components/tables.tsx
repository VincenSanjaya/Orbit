'use client';
import { useState } from 'react';
import Decimal from 'decimal.js';
import { ListOrdered, ArrowUpRight, ReceiptText } from 'lucide-react';
import { ASSETS, fmt, date, priceDigits, type Order, type Ledger } from '@/lib/shared';
import { api, useApp } from './provider';
import { Empty, Modal } from './ui';
export function OrderTable({
  orders,
  compactView = false,
  emptyText = 'Your orders will appear here.',
}: {
  orders: Order[];
  compactView?: boolean;
  emptyText?: string;
}) {
  const [selected, setSelected] = useState<Order | null>(null),
    [busy, setBusy] = useState<string | null>(null),
    { refresh, toast } = useApp();
  const orderDigits = (o: Order) =>
    Math.min(
      12,
      Math.max(
        priceDigits(o.symbol),
        new Decimal(o.execution_price || o.limit_price || 0).decimalPlaces(),
      ),
    );
  const cancel = async (order: Order) => {
    setBusy(order.id);
    try {
      await api('orders/cancel', { id: order.id });
      toast('Order canceled. Reserved funds released.');
      setSelected(null);
      await refresh();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(null);
    }
  };
  if (!orders.length)
    return <Empty icon={<ListOrdered size={23} />} title="A clean slate" description={emptyText} />;
  return (
    <>
      <div className="table-scroll">
        <table className={`data-table ${compactView ? 'compact-table' : ''}`}>
          <thead>
            <tr>
              <th>Pair / time</th>
              <th>Side / type</th>
              <th>Price (USDT)</th>
              <th>Quantity / filled</th>
              {!compactView && (
                <>
                  <th>Total (USDT)</th>
                  <th>Fee (USDT)</th>
                </>
              )}
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id}>
                <td>
                  <strong>{o.symbol}/USDT</strong>
                  <small>{date(o.created_at)}</small>
                </td>
                <td>
                  <span className={o.side === 'BUY' ? 'positive' : 'negative'}>{o.side}</span>
                  <small>
                    {o.type} · {o.mode === 'live' ? 'Binance Live' : 'Simulated'}
                  </small>
                </td>
                <td>
                  {o.execution_price
                    ? fmt(o.execution_price, orderDigits(o))
                    : o.limit_price
                      ? fmt(o.limit_price, orderDigits(o))
                      : '—'}
                </td>
                <td>
                  {o.quantity}
                  <small>Filled {o.filled_quantity}</small>
                </td>
                {!compactView && (
                  <>
                    <td>
                      {o.execution_price || o.limit_price
                        ? fmt(
                            new Decimal(o.execution_price || o.limit_price!)
                              .mul(o.execution_price ? o.filled_quantity : o.quantity)
                              .toString(),
                          )
                        : '—'}
                    </td>
                    <td>{fmt(o.fee, 4)}</td>
                  </>
                )}
                <td>
                  <span className={`status-badge status-${o.status.toLowerCase()}`}>
                    {o.status.toLowerCase()}
                  </span>
                </td>
                <td>
                  <div className="table-actions">
                    {o.status === 'OPEN' && (
                      <button
                        className="text-button"
                        disabled={busy === o.id}
                        onClick={() => cancel(o)}
                      >
                        {busy === o.id ? '…' : 'Cancel'}
                      </button>
                    )}
                    <button
                      className="icon-button"
                      aria-label={`View order ${o.id}`}
                      onClick={() => setSelected(o)}
                    >
                      <ArrowUpRight size={15} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Modal
        open={!!selected}
        onOpenChange={(v) => {
          if (!v) setSelected(null);
        }}
        title="Order details"
        description="Server-authoritative order record. Limit fills are all-or-nothing."
      >
        {selected && (
          <>
            <div className="confirm-details">
              <div>
                <span>Pair / side</span>
                <strong>
                  {selected.symbol}/USDT · {selected.side}
                </strong>
              </div>
              <div>
                <span>Type / status</span>
                <strong>
                  {selected.type} · {selected.status}
                </strong>
              </div>
              <div>
                <span>Price source</span>
                <strong>{selected.mode === 'live' ? 'Binance Live' : 'Simulated'}</strong>
              </div>
              <div>
                <span>Quote / slippage</span>
                <strong>
                  {selected.snapshot_price || '—'} · {selected.slippage_bps} bps
                </strong>
              </div>
              <div>
                <span>Requested / filled</span>
                <strong>
                  {selected.quantity} / {selected.filled_quantity}
                </strong>
              </div>
              <div>
                <span>Limit / execution price</span>
                <strong>
                  {selected.limit_price || '—'} / {selected.execution_price || '—'}
                </strong>
              </div>
              <div>
                <span>Executed value (USDT)</span>
                <strong>
                  {selected.execution_price
                    ? new Decimal(selected.execution_price)
                        .mul(selected.filled_quantity)
                        .toDecimalPlaces(8)
                        .toFixed()
                    : '—'}
                </strong>
              </div>
              <div>
                <span>Actual fee</span>
                <strong>
                  {selected.fee} {selected.fee_currency}
                </strong>
              </div>
              <div>
                <span>Reserved</span>
                <strong>
                  {selected.reserved} {selected.side === 'BUY' ? 'USDT' : selected.symbol}
                </strong>
              </div>
              <div>
                <span>Submitted</span>
                <strong>{date(selected.created_at)}</strong>
              </div>
              {selected.reason && <p className="negative">{selected.reason}</p>}
              <span className="muted small-text break-text">Order ID: {selected.id}</span>
            </div>
            {selected.status === 'OPEN' && (
              <button
                className="button secondary full"
                disabled={busy === selected.id}
                onClick={() => cancel(selected)}
              >
                Cancel order & release funds
              </button>
            )}
          </>
        )}
      </Modal>
    </>
  );
}
export function HistoryTable({ ledger }: { ledger: Ledger[] }) {
  if (!ledger.length)
    return (
      <Empty
        icon={<ReceiptText />}
        title="Nothing here yet"
        description="Funding, settlement, reservation, cancellation, and reset events appear here."
      />
    );
  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th>Transaction</th>
            <th>Asset</th>
            <th>Available change</th>
            <th>Reserved change</th>
            <th>Time</th>
            <th>Reference</th>
          </tr>
        </thead>
        <tbody>
          {ledger.map((l) => (
            <tr key={l.id}>
              <td>
                <strong>{l.kind.toLowerCase().replaceAll('_', ' ')}</strong>
              </td>
              <td>{l.asset}</td>
              <td className={Number(l.available_delta) >= 0 ? 'positive' : 'negative'}>
                {Number(l.available_delta) > 0 ? '+' : ''}
                {l.available_delta}
              </td>
              <td>
                {Number(l.reserved_delta) > 0 ? '+' : ''}
                {l.reserved_delta}
              </td>
              <td>{date(l.created_at)}</td>
              <td>
                <span className="muted small-text" title={l.order_id || l.id}>
                  {(l.order_id || l.id).slice(0, 8)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function Filters({
  asset,
  setAsset,
  side,
  setSide,
  status,
  setStatus,
  from,
  setFrom,
  to,
  setTo,
  history = false,
}: {
  asset: string;
  setAsset: (v: string) => void;
  side: string;
  setSide: (v: string) => void;
  status: string;
  setStatus: (v: string) => void;
  from: string;
  setFrom: (v: string) => void;
  to: string;
  setTo: (v: string) => void;
  history?: boolean;
}) {
  return (
    <div className="filters">
      <select aria-label="Filter by asset" value={asset} onChange={(e) => setAsset(e.target.value)}>
        <option value="">All assets</option>
        {history && <option>USDT</option>}
        {ASSETS.map((a) => (
          <option key={a.symbol}>{a.symbol}</option>
        ))}
      </select>
      {!history && (
        <>
          <select
            aria-label="Filter by side"
            value={side}
            onChange={(e) => setSide(e.target.value)}
          >
            <option value="">All sides</option>
            <option>BUY</option>
            <option>SELL</option>
          </select>
          <select
            aria-label="Filter by status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">All statuses</option>
            {['OPEN', 'FILLED', 'CANCELED', 'REJECTED'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </>
      )}
      <label>
        From{' '}
        <input
          aria-label="Start date"
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
      </label>
      <label>
        To{' '}
        <input
          aria-label="End date"
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
      </label>
    </div>
  );
}
