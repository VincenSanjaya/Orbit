import { simulatedRules } from './live/quotes';
import Decimal from 'decimal.js';
import { db } from './db';
import { ASSETS, TIMEFRAMES, type Timeframe, type Candle, type MarketSnapshot } from './shared';
import { D, money, MAKER, TAKER, AppError } from './money';
const quantize = (v: string, symbol: string) => {
  const asset = ASSETS.find((a) => a.symbol === symbol)!;
  return D(v).div(asset.tick).round().mul(asset.tick).toFixed();
};
export function initializeMarket() {
  db()
    .transaction(() => {
      const insert = db().prepare('INSERT INTO candles VALUES(?,?,?,?,?,?,?)');
      const end = Math.floor(Date.now() / 60000) * 60;
      for (const asset of ASSETS) {
        if (db().prepare('SELECT symbol FROM market_state WHERE symbol=?').get(asset.symbol))
          continue;
        let price = D(asset.initial).mul('0.97');
        // Original synthetic history, never represented as historical public quotes.
        let seed = asset.symbol.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
        const random = () => {
          seed = (seed * 16807) % 2147483647;
          return seed / 2147483647;
        };
        for (let i = 10080; i >= 0; i--) {
          const open = price;
          const pull = D(asset.initial).sub(price).div(asset.initial).mul('0.001');
          price = price.mul(
            D(1)
              .add(D(random().toFixed(8)).sub('0.49').mul('0.0014'))
              .add(pull),
          );
          const high = Decimal.max(open, price).mul(D(1).add(D(random().toFixed(8)).mul('0.0005')));
          const low = Decimal.min(open, price).mul(D(1).sub(D(random().toFixed(8)).mul('0.0005')));
          const volume = money(
            D(50)
              .add(D(random().toFixed(8)).mul(800))
              .div(asset.initial)
              .mul(100),
          );
          insert.run(
            asset.symbol,
            end - i * 60,
            quantize(open.toFixed(), asset.symbol),
            quantize(high.toFixed(), asset.symbol),
            quantize(low.toFixed(), asset.symbol),
            quantize(price.toFixed(), asset.symbol),
            volume,
          );
        }
        db()
          .prepare('INSERT INTO market_state VALUES(?,?,?)')
          .run(asset.symbol, quantize(price.toFixed(), asset.symbol), Date.now());
      }
    })
    .immediate();
}
export function currentPrice(symbol: string) {
  const row = db().prepare('SELECT price FROM market_state WHERE symbol=?').get(symbol) as
    { price: string } | undefined;
  if (!row) throw new AppError('Unsupported market.', 400);
  return row.price;
}
// Caller owns an immediate transaction; no replay of market movement during server downtime.
export function tickMarket(now = Date.now()) {
  const first = db().prepare('SELECT last_tick FROM market_state LIMIT 1').get() as {
    last_tick: number;
  };
  if (now - first.last_tick < 3000) return false;
  const time = Math.floor(now / 60000) * 60;
  for (const asset of ASSETS) {
    const previous = currentPrice(asset.symbol);
    const drift = D(Math.random().toFixed(8)).sub('0.5').mul('0.0012');
    const pull = D(asset.initial).sub(previous).div(asset.initial).mul('0.0001');
    const price = quantize(
      D(previous)
        .mul(D(1).add(drift).add(pull))
        .clamp(D(asset.initial).mul('0.5'), D(asset.initial).mul('1.5'))
        .toFixed(),
      asset.symbol,
    );
    const quantity = money(D(Math.random().toFixed(8)).mul(3000).add(100).div(price));
    db()
      .prepare('UPDATE market_state SET price=?,last_tick=? WHERE symbol=?')
      .run(price, now, asset.symbol);
    const c = db()
      .prepare('SELECT * FROM candles WHERE symbol=? AND time=?')
      .get(asset.symbol, time) as Candle | undefined;
    if (c)
      db()
        .prepare('UPDATE candles SET high=?,low=?,close=?,volume=? WHERE symbol=? AND time=?')
        .run(
          Decimal.max(c.high, price).toFixed(),
          Decimal.min(c.low, price).toFixed(),
          price,
          money(D(c.volume).add(quantity)),
          asset.symbol,
          time,
        );
    else
      db()
        .prepare('INSERT INTO candles VALUES(?,?,?,?,?,?,?)')
        .run(
          asset.symbol,
          time,
          previous,
          Decimal.max(previous, price).toFixed(),
          Decimal.min(previous, price).toFixed(),
          price,
          quantity,
        );
    db()
      .prepare('INSERT INTO market_trades(symbol,price,quantity,side,time) VALUES(?,?,?,?,?)')
      .run(asset.symbol, price, quantity, D(price).gte(previous) ? 'BUY' : 'SELL', now);
  }
  db()
    .prepare('DELETE FROM market_trades WHERE time<?')
    .run(now - 86400000);
  db()
    .prepare('DELETE FROM candles WHERE time<?')
    .run(Math.floor(now / 1000) - 30 * 86400);
  return true;
}
export function aggregateCandles(symbol: string, timeframe: Timeframe): Candle[] {
  const seconds = TIMEFRAMES[timeframe];
  const rows = db()
    .prepare('SELECT * FROM candles WHERE symbol=? AND time>=? ORDER BY time')
    .all(symbol, Math.floor(Date.now() / 1000) - seconds * 260) as Candle[];
  const candles: Candle[] = [];
  for (const row of rows) {
    const time = Math.floor(row.time / seconds) * seconds,
      last = candles.at(-1);
    if (last?.time === time) {
      last.high = Decimal.max(last.high, row.high).toFixed();
      last.low = Decimal.min(last.low, row.low).toFixed();
      last.close = row.close;
      last.volume = money(D(last.volume).add(row.volume));
    } else candles.push({ ...row, time });
  }
  return candles.slice(-240);
}
export interface MarketProvider {
  snapshot(symbol: string, timeframe: Timeframe): Promise<MarketSnapshot>;
}
export const simulatedProvider: MarketProvider = {
  async snapshot(symbol, timeframe) {
    const markets = ASSETS.map((asset) => {
      const rows = db()
        .prepare('SELECT * FROM candles WHERE symbol=? AND time>=? ORDER BY time')
        .all(asset.symbol, Math.floor(Date.now() / 1000) - 86400) as Candle[];
      const price = currentPrice(asset.symbol);
      let high = D(price),
        low = D(price),
        volume = D(0);
      for (const row of rows) {
        high = Decimal.max(high, row.high);
        low = Decimal.min(low, row.low);
        volume = volume.add(D(row.volume).mul(row.close));
      }
      return {
        symbol: asset.symbol,
        name: asset.name,
        price,
        change: D(price)
          .div(rows[0]?.open || price)
          .sub(1)
          .mul(100)
          .toFixed(2),
        high: high.toFixed(),
        low: low.toFixed(),
        volume: money(volume),
        spark: rows
          .filter((_, i) => i % Math.max(1, Math.floor(rows.length / 32)) === 0)
          .map((c) => c.close),
      };
    });
    const price = D(currentPrice(symbol));
    const level = (side: number, i: number) => ({
      price: quantize(
        price
          .mul(
            D(1).add(
              D('0.00012')
                .mul(i + 1)
                .mul(side),
            ),
          )
          .toFixed(),
        symbol,
      ),
      quantity: money(
        D(i + 1)
          .mul('350')
          .div(price),
      ),
    });
    const updated = db()
      .prepare('SELECT last_tick FROM market_state WHERE symbol=?')
      .get(symbol) as { last_tick: number };
    return {
      source: 'simulated',
      label: 'ORBIT simulated market',
      status: 'SIMULATED',
      instruments: Object.fromEntries(ASSETS.map((a) => [a.symbol, simulatedRules(a.symbol)])),
      slippageBps: '0',
      maxQuoteAgeMs: 10000,
      updatedAt: updated.last_tick,
      markets,
      candles: aggregateCandles(symbol, timeframe),
      trades: db()
        .prepare(
          'SELECT price,quantity,side,time FROM market_trades WHERE symbol=? ORDER BY time DESC LIMIT 20',
        )
        .all(symbol) as MarketSnapshot['trades'],
      book: {
        asks: Array.from({ length: 10 }, (_, i) => level(1, i)),
        bids: Array.from({ length: 10 }, (_, i) => level(-1, i)),
      },
      makerFee: MAKER,
      takerFee: TAKER,
    };
  },
};

export { liveProvider as publicProvider } from './live/provider';
