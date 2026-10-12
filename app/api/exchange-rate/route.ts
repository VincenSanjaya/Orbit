import { usdIdrRate } from '@/lib/exchange-rate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    return Response.json(await usdIdrRate(), { headers });
  } catch {
    return Response.json(
      { error: 'Rupiah exchange rate is temporarily unavailable.' },
      { status: 503, headers },
    );
  }
}
