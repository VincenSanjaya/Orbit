import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const NOW = new Date('2026-10-12T12:00:00Z');
const quote = { base: 'USD', quote: 'IDR', rate: 17880, date: '2026-10-12' };
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('shares concurrent requests and caches daily sourced quotes for an hour', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json(quote));
  vi.stubGlobal('fetch', fetcher);
  const { usdIdrRate } = await import('../lib/exchange-rate');
  const values = await Promise.all([usdIdrRate(), usdIdrRate()]);
  expect(values[0]).toMatchObject({ rate: '17880', source: 'Frankfurter', cached: false });
  await usdIdrRate();
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('labels a cached rate during provider outage and retries after a cooldown', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json(quote))
    .mockRejectedValue(new Error('offline'));
  vi.stubGlobal('fetch', fetcher);
  const { usdIdrRate } = await import('../lib/exchange-rate');
  await usdIdrRate();
  vi.setSystemTime(new Date(NOW.getTime() + 3600001));
  expect((await usdIdrRate()).cached).toBe(true);
  await usdIdrRate();
  expect(fetcher).toHaveBeenCalledTimes(2);
  vi.setSystemTime(new Date(NOW.getTime() + 3660002));
  fetcher.mockResolvedValue(Response.json(quote));
  expect((await usdIdrRate()).cached).toBe(false);
});

it.each([
  { ...quote, rate: -1 },
  { ...quote, rate: null },
  { ...quote, quote: 'JPY' },
  { ...quote, date: '2026-09-01' },
  { ...quote, date: '2026-10-20' },
])('rejects unusable provider data: %j', async (data) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(data)));
  const { usdIdrRate } = await import('../lib/exchange-rate');
  await expect(usdIdrRate()).rejects.toThrow('temporarily unavailable');
});

it('never serves an expired cached quote after an outage', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json(quote))
    .mockRejectedValue(new Error('offline'));
  vi.stubGlobal('fetch', fetcher);
  const { usdIdrRate } = await import('../lib/exchange-rate');
  await usdIdrRate();
  vi.setSystemTime(new Date('2026-10-20T12:00:00Z'));
  await expect(usdIdrRate()).rejects.toThrow('temporarily unavailable');
  await expect(usdIdrRate()).rejects.toThrow('temporarily unavailable');
  expect(fetcher).toHaveBeenCalledTimes(2);
});
