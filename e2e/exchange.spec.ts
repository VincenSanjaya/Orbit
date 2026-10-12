import { test, expect, type Page } from '@playwright/test';
import Decimal from 'decimal.js';
const email = `browser-${Date.now()}@orbit.test`;
const password = 'orbit-browser-pass-123';
async function getAccount(page: Page) {
  return page.evaluate(async () => {
    const r = await fetch('/api/account');
    return r.json();
  });
}
async function register(
  page: Page,
  emailAddress = email,
  mode: 'live' | 'simulated' = 'simulated',
) {
  await page.goto('/register');
  await page.getByLabel('Your name', { exact: true }).fill('Browser Trader');
  await page.getByLabel('Email address').fill(emailAddress);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page).toHaveURL('/portfolio');
  expect((await getAccount(page)).equity).toBe('0');
  await page.goto('/wallet');
  await page.getByRole('button', { name: 'Add virtual funds', exact: true }).click();
  await page.getByRole('button', { name: 'Add 1,000 virtual USDT', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.evaluate(async (mode) => {
    await fetch('/api/account/mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    });
  }, mode);
  await page.goto('/portfolio');
}
test('complete persistent trading, funding, and reset workflow', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Find your edge. Make your move.' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Explore markets', exact: true }).click();
  await expect(page).toHaveURL('/markets');
  await expect(page.locator('.market-table tbody tr')).toHaveCount(16);
  const beforePrice = await page.evaluate(async () => {
    const r = await fetch('/api/market?mode=simulated');
    return (await r.json()).markets[0].price;
  });
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const r = await fetch('/api/market?mode=simulated');
        return (await r.json()).markets[0].price;
      }),
    )
    .not.toBe(beforePrice);
  await register(page);
  await page.getByRole('link', { name: 'Make a move', exact: true }).click();
  await expect(page).toHaveURL('/trade/BTC-USDT');
  await expect(page.locator('.pair-price strong')).not.toHaveText('—');
  await page.getByLabel('Order quantity').fill('0.001');
  await page.getByRole('button', { name: 'Buy BTC', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Confirm paper order' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  let account = await getAccount(page);
  const buy = account.orders[0];
  expect(buy.status).toBe('FILLED');
  expect(buy.side).toBe('BUY');
  const cost = new Decimal(buy.execution_price)
    .mul(buy.filled_quantity)
    .toDecimalPlaces(8)
    .add(buy.fee);
  expect(
    new Decimal(account.balances.find((b: { asset: string }) => b.asset === 'USDT').available).eq(
      new Decimal(1000).sub(cost),
    ),
  ).toBe(true);
  expect(account.balances.find((b: { asset: string }) => b.asset === 'BTC').available).toBe(
    '0.001',
  );
  await page.getByRole('button', { name: 'Sell', exact: true }).click();
  await page.getByLabel('Order quantity').fill('0.0005');
  await page.getByRole('button', { name: 'Sell BTC', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm paper order' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  account = await getAccount(page);
  expect(account.balances.find((b: { asset: string }) => b.asset === 'BTC').available).toBe(
    '0.0005',
  );
  expect(account.orders.filter((o: { status: string }) => o.status === 'FILLED')).toHaveLength(2);
  const sale = account.orders.find((o: { side: string }) => o.side === 'SELL');
  const pnl = new Decimal(sale.execution_price)
    .mul(sale.quantity)
    .toDecimalPlaces(8)
    .sub(sale.fee)
    .sub(cost.div(2).toDecimalPlaces(8))
    .toDecimalPlaces(8);
  expect(new Decimal(account.realized).eq(pnl)).toBe(true);
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  await page.getByRole('button', { name: 'Limit', exact: true }).click();
  await page.getByLabel('Limit price').fill('10000');
  await page.getByLabel('Order quantity').fill('0.001');
  await page.getByRole('button', { name: 'Buy BTC', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm paper order' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  account = await getAccount(page);
  expect(account.orders[0].status).toBe('OPEN');
  expect(account.balances.find((b: { asset: string }) => b.asset === 'USDT').reserved).toBe(
    '10.01',
  );
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Order canceled');
  account = await getAccount(page);
  expect(account.balances.find((b: { asset: string }) => b.asset === 'USDT').reserved).toBe('0');
  await page.goto('/portfolio');
  const equity = await getAccount(page);
  expect(
    new Decimal(equity.equity).eq(
      new Decimal(equity.netDeposits).add(equity.realized).add(equity.unrealized),
    ),
  ).toBe(true);
  await page.goto('/history');
  await expect(page.getByText('account opened', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Executions & fees' }).click();
  await expect(page.locator('table tbody tr')).toHaveCount(2);
  await page.reload();
  await expect(page.locator('table tbody tr')).toHaveCount(8); // defaults to ledger after refresh
  await page.goto('/orders');
  await expect(page.locator('table tbody tr')).toHaveCount(3);
  await page.getByLabel('Filter by side').selectOption('SELL');
  await expect(page.locator('table tbody tr')).toHaveCount(1);
  await page.goto('/wallet');
  await page.getByRole('button', { name: 'Reset paper balances', exact: true }).click();
  await page.getByLabel('Type RESET to confirm').fill('RESET');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Reset paper balances', exact: true })
    .click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('heading', { name: '0.00 USDT', exact: true })).toBeVisible();
  account = await getAccount(page);
  expect(account.orders).toHaveLength(3);
  expect(account.realized).toBe('0');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.goto('/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL('/portfolio');
  await page.goto('/orders');
  await expect(page.locator('table tbody tr')).toHaveCount(3);
  expect(errors).toEqual([]);
});
test('API rejects unauthenticated and cross-origin mutations', async ({ request }) => {
  expect((await request.get('/api/market?mode=live&timeframe=constructor')).status()).toBe(400);
  expect((await request.get('/api/account')).status()).toBe(401);
  expect((await request.post('/api/orders', { data: { mode: 'simulated' } })).status()).toBe(401);
  expect(
    (
      await request.post('/api/auth/register', {
        headers: { origin: 'https://attacker.invalid' },
        data: {},
      })
    ).status(),
  ).toBe(403);
});
test('live provider failure is visible and never silently replaced', async ({ page }) => {
  await page.route('**/api/market**', async (route) => {
    if (route.request().url().includes('mode=live'))
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Binance provider unavailable. Retrying.' }),
      });
    else await route.continue();
  });
  await page.goto('/markets');
  await page.getByLabel('Market data source').selectOption('simulated');
  await expect(page.locator('.market-table tbody tr')).toHaveCount(16);
  await page.getByLabel('Market data source').selectOption('live');
  await expect(page.locator('.error-banner')).toBeVisible();
  await expect(page.getByLabel('Market data source')).toHaveValue('live');
  await expect(page.locator('.market-table tbody tr')).toHaveCount(0);
  await expect(page.locator('.feed-badge')).not.toHaveText('SIMULATED');
  await page.getByLabel('Market data source').selectOption('simulated');
  await expect(page.locator('.market-table tbody tr')).toHaveCount(16);
});
for (const width of [1440, 1024, 375, 320]) {
  test(`responsive routes, navigation and chart at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    for (const path of ['/', '/markets', '/trade/BTC-USDT', '/register', '/login', '/wallet']) {
      await page.goto(path);
      await expect(page.locator('h1, h3, .pair-price strong').first()).toBeVisible();
      if (path === '/trade/BTC-USDT' || path === '/')
        await expect(page.locator('.candle-chart canvas').first()).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      );
      expect(overflow, `page overflow at ${path} ${width}px`).toBe(false);
    }
    if (width < 640) {
      await page.getByRole('button', { name: 'Open navigation' }).click();
      await page.locator('.mobile-nav').getByRole('link', { name: 'Markets', exact: true }).click();
      await expect(page).toHaveURL('/markets');
    }
    expect(errors).toEqual([]);
  });
}
test('mobile authenticated trading and persistent account screens', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 850 });
  await register(page, `mobile-${Date.now()}@orbit.test`);
  await page.goto('/trade/ETH-USDT');
  await expect(page.locator('.pair-selector strong')).toContainText('ETH');
  await expect(page.locator('.pair-price strong')).not.toHaveText('—');
  await page.getByLabel('Order quantity').fill('0.01');
  await page.getByRole('button', { name: 'Buy ETH', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm paper order' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  for (const path of ['/portfolio', '/wallet', '/orders', '/history', '/settings']) {
    await page.goto(path);
    await expect(page.locator('h1')).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
      `overflow at ${path}`,
    ).toBe(false);
  }
});

test('genuine HYPE REST bootstrap, candle updates, live paper fills and market switching', async ({
  page,
}) => {
  test.setTimeout(150000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await register(page, `hype-${Date.now()}@orbit.test`, 'live');
  await page.goto('/trade/HYPE-USDT');
  await expect(page.locator('.feed-badge')).toHaveText('LIVE');
  await expect(page.locator('.pair-selector strong')).toContainText('HYPE');
  await expect(page.locator('.candle-chart canvas').first()).toBeVisible();
  const snapshot = () =>
    page.evaluate(async () => {
      const r = await fetch('/api/market?symbol=HYPE&timeframe=15m&mode=live');
      return r.json();
    });
  await expect
    .poll(async () => (await snapshot()).candles.length, { timeout: 30000 })
    .toBeGreaterThan(200);
  const first = await snapshot();
  expect(first.instruments.HYPE.spotAllowed).toBe(true);
  expect(first.book.bids.length).toBeGreaterThan(0);
  expect(first.trades.length).toBeGreaterThan(0);
  const candleTime = first.candleUpdatedAt;
  await expect
    .poll(async () => (await snapshot()).candleUpdatedAt, { timeout: 60000 })
    .toBeGreaterThan(candleTime);
  await page.getByLabel('Order quantity').fill('1');
  await page.getByRole('button', { name: 'Buy HYPE', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm paper order' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  let a = await getAccount(page);
  const buy = a.orders[0];
  expect(buy.mode).toBe('live');
  expect(buy.status).toBe('FILLED');
  expect(Number(buy.snapshot_price)).toBeGreaterThan(0);
  expect(buy.quote_time).toBeGreaterThan(Date.now() - 10000);
  expect(
    new Decimal(buy.fee).eq(
      new Decimal(buy.quantity).mul(buy.execution_price).mul('0.0015').toDecimalPlaces(8),
    ),
  ).toBe(true);
  await page.getByRole('button', { name: 'Sell', exact: true }).click();
  await page.getByLabel('Order quantity').fill('0.5');
  await page.getByRole('button', { name: 'Sell HYPE', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm paper order' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  a = await getAccount(page);
  expect(a.balances.find((b: { asset: string }) => b.asset === 'HYPE').available).toBe('0.5');
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  await page.getByRole('button', { name: 'Limit', exact: true }).click();
  await page.getByLabel('Limit price').fill('5');
  await page.getByLabel('Order quantity').fill('1');
  await page.getByRole('button', { name: 'Buy HYPE', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm paper order' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  a = await getAccount(page);
  expect(a.orders[0].mode).toBe('live');
  expect(a.orders[0].status).toBe('OPEN');
  expect(a.balances.find((b: { asset: string }) => b.asset === 'USDT').reserved).toBe('5.005');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: '5m', exact: true }).click();
  await expect
    .poll(
      async () =>
        page.evaluate(async () => {
          const r = await fetch('/api/market?symbol=HYPE&timeframe=5m&mode=live');
          return (await r.json()).candles.length;
        }),
      { timeout: 30000 },
    )
    .toBeGreaterThan(200);
  await page.getByLabel('Select trading pair').click();
  await page.getByLabel('Search assets…').fill('PEPE');
  await page.getByRole('dialog').getByRole('link').click();
  await expect(page).toHaveURL('/trade/PEPE-USDT');
  await expect(page.locator('.pair-selector strong')).toContainText('PEPE');
  await expect(page.locator('.pair-price strong')).toContainText('0.000');
  await page.goto('/markets');
  await page.getByLabel('Add HYPE to watchlist').click();
  await page.reload();
  await expect(page.getByLabel('Remove HYPE from watchlist')).toBeVisible();
  await page.getByRole('button', { name: 'Watchlist', exact: true }).click();
  await expect(page.locator('.market-table tbody tr')).toHaveCount(1);
  expect(errors).toEqual([]);
});
