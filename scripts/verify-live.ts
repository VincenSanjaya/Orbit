import assert from 'node:assert/strict';
import { BinanceRest } from '../lib/live/rest';
import { ASSETS, type MarketSnapshot } from '../lib/shared';
async function main() {
  const rest = new BinanceRest();
  const info = await rest.get<{
    symbols: {
      symbol: string;
      status: string;
      isSpotTradingAllowed: boolean;
      filters: { filterType: string; tickSize?: string; stepSize?: string }[];
    }[];
  }>('exchangeInfo', { symbol: 'HYPEUSDT' }, 0, 20);
  assert.equal(info.symbols[0].status, 'TRADING');
  assert.equal(info.symbols[0].isSpotTradingAllowed, true);
  const history = await rest.get<(string | number)[][]>('klines', {
    symbol: 'HYPEUSDT',
    interval: '15m',
    limit: 240,
  });
  assert.equal(history.length, 240);
  const base = process.env.E2E_BASE_URL || 'http://127.0.0.1:3000';
  const snapshot = async () => {
    const response = await fetch(base + '/api/market?symbol=HYPE&timeframe=15m&mode=live');
    assert(response.ok);
    return (await response.json()) as MarketSnapshot;
  };
  let first = await snapshot();
  for (
    let i = 0;
    i < 30 &&
    (first.status !== 'LIVE' ||
      first.candles.length < 200 ||
      !first.book.bids.length ||
      !first.trades.length);
    i++
  ) {
    await new Promise((r) => setTimeout(r, 1000));
    first = await snapshot();
  }
  assert.equal(first.source, 'live');
  assert.equal(first.status, 'LIVE');
  assert(first.instruments.HYPE.spotAllowed);
  assert(first.candles.length > 200);
  assert(first.book.bids.length > 0);
  assert(first.trades.length > 0);
  assert.equal(first.markets.length, ASSETS.length);
  assert(first.markets.every((m) => m.price !== null && Number(m.price) > 0));
  let next = first;
  for (let i = 0; i < 60 && next.candleUpdatedAt === first.candleUpdatedAt; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    next = await snapshot();
  }
  assert(next.candleUpdatedAt! > first.candleUpdatedAt!, 'Streamed HYPE candle did not update');
  console.log(
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        provider: 'Binance market-data-only Spot',
        registeredMarkets: ASSETS.length,
        allLiveQuotesValid: true,
        hypeStatus: info.symbols[0].status,
        tickSize: first.instruments.HYPE.tickSize,
        lotSize: first.instruments.HYPE.stepSize,
        restHistoryBars: history.length,
        serverHistoryBars: first.candles.length,
        depthLevels: first.book.bids.length,
        recentTrades: first.trades.length,
        liveCandleUpdated: true,
        feedStatus: next.status,
      },
      null,
      2,
    ),
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
