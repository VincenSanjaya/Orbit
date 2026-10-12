import { test, expect } from '@playwright/test';

test.skip(
  !process.env.E2E_BACKEND_ORIGIN,
  'Run against a web proxy connected to an isolated backend.',
);

test('proxy preserves login cookies, authoritative paper fills, and wallet persistence', async ({
  page,
}) => {
  await page.goto('/register');
  await page.getByLabel('Your name', { exact: true }).fill('Proxy Trader');
  await page.getByLabel('Email address').fill(`proxy-${Date.now()}@orbit.test`);
  await page.getByLabel('Password', { exact: true }).fill('proxy-browser-pass-123');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page).toHaveURL('/portfolio');
  await page.goto('/wallet');
  await expect(page.getByLabel('Total assets value')).toHaveText('$0.00 USD');
  await page.getByRole('button', { name: 'Deposit', exact: true }).click();
  await page.getByRole('button', { name: 'Add 1,000 virtual USDT', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByLabel('Total assets value')).toHaveText('$1,000.00 USD');
  const mode = await page.evaluate(async () => {
    const response = await fetch('/api/account/mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'simulated' }),
    });
    return response.status;
  });
  expect(mode).toBe(200);
  await page.goto('/trade/HYPE-USDT');
  await page.getByLabel('Order quantity').fill('1');
  await page.getByRole('button', { name: 'Buy HYPE', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm paper order' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  const before = await (await page.request.get('/api/account')).json();
  expect(before.orders[0].status).toBe('FILLED');
  expect(before.balances.find((b: { asset: string }) => b.asset === 'HYPE').available).toBe('1');
  await page.reload();
  const after = await (await page.request.get('/api/account')).json();
  expect(after.balances).toEqual(before.balances);
  expect(after.orders).toEqual(before.orders);
  expect(after.ledger).toEqual(before.ledger);
  const rejected = await page.request.post('/api/wallet/faucet', {
    data: {},
    headers: { origin: 'https://attacker.invalid' },
  });
  expect(rejected.status()).toBe(403);
});

test('proxy delivers genuine market snapshots, streaming events, and exchange rates', async ({
  page,
}) => {
  await page.goto('/markets');
  const snapshot = await (
    await page.request.get('/api/market?symbol=HYPE&timeframe=15m&mode=live')
  ).json();
  expect(snapshot.source).toBe('live');
  expect(snapshot.markets).toHaveLength(16);
  await expect
    .poll(
      async () => {
        const current = await (
          await page.request.get('/api/market?symbol=HYPE&timeframe=15m&mode=live')
        ).json();
        return current.candles.length;
      },
      { timeout: 30000 },
    )
    .toBeGreaterThan(0);
  const count = await page.evaluate(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(
      `/api/market/stream?symbol=HYPE&timeframe=15m&mode=live&clientId=${crypto.randomUUID()}`,
      { signal: controller.signal },
    );
    const reader = response.body!.getReader();
    let text = '';
    try {
      while (text.split('data: ').length - 1 < 2) {
        const packet = await reader.read();
        if (packet.done) break;
        text += new TextDecoder().decode(packet.value);
      }
      return text.split('data: ').length - 1;
    } finally {
      clearTimeout(timer);
      await reader.cancel();
    }
  });
  expect(count).toBeGreaterThanOrEqual(2);
  const rate = await (await page.request.get('/api/exchange-rate')).json();
  expect(Number(rate.rate)).toBeGreaterThan(0);
  expect(rate.source).toBe('Frankfurter');
});
