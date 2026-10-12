import { notFound } from 'next/navigation';
import { TradingTerminal } from '@/components/terminal';
import { ASSETS } from '@/lib/shared';
export async function generateMetadata({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  return { title: `Trade ${symbol.replace('-', '/')}` };
}
export default async function Trade({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const base = symbol.split('-')[0].toUpperCase();
  if (!ASSETS.some((a) => a.symbol === base)) notFound();
  return (
    <main className="trade-page">
      <div className="trade-page-heading">
        <span className="eyebrow">SPOT TERMINAL</span>
        <span>Practice with perspective. Every order is virtual.</span>
      </div>
      <TradingTerminal initialSymbol={base} />
    </main>
  );
}
