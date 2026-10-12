import { test, expect, type Page } from '@playwright/test';

async function openWallet(page: Page) {
  // Create a separate empty account; never modify the owner's wallet.
  const response = await page.request.post('/api/auth/register', {
    data: {
      name: 'Wallet QA',
      email: `wallet-${Date.now()}-${Math.random()}@orbit.test`,
      password: 'wallet-test-pass-123',
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  await page.goto('/wallet');
  await expect(page.getByLabel('Total assets value')).toHaveText('$0.00 USD');
}

const rate = {
  base: 'USD',
  quote: 'IDR',
  rate: '17880',
  date: '2026-10-12',
  source: 'Frankfurter',
  cached: false,
};

test('wallet total includes reserved and crypto holdings, switches currency, and persists on mobile', async ({
  page,
}) => {
  await page.route('**/api/exchange-rate', (route) => route.fulfill({ json: rate }));
  await openWallet(page);
  const before = await (await page.request.get('/api/account')).json();
  const balances = before.balances.map((balance: { asset: string }) =>
    balance.asset === 'USDT'
      ? { ...balance, available: '100', reserved: '49', value: '149' }
      : balance.asset === 'HYPE'
        ? { ...balance, available: '2', reserved: '2', value: '200' }
        : balance,
  );
  await page.route('**/api/account', (route) =>
    route.fulfill({ json: { ...before, equity: '349', balances } }),
  );
  await page.reload();
  await expect(page.getByLabel('Total assets value')).toHaveText('$349.00 USD');
  await page.getByLabel('Total assets currency').selectOption('IDR');
  await expect(page.getByLabel('Total assets value')).toHaveText('Rp 6.240.120 IDR');
  await expect(page.locator('.wallet-rate')).toContainText('1 USD = Rp 17.880');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByLabel('Total assets currency')).toHaveValue('IDR');
  await expect(page.getByLabel('Total assets value')).toHaveText('Rp 6.240.120 IDR');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'test-results/wallet-idr-mobile.png', fullPage: true });
  await page.getByLabel('Total assets currency').selectOption('USD');
  await expect(page.getByLabel('Total assets value')).toHaveText('$349.00 USD');
  // Conversion never writes to the server's balances or ledger.
  await page.unroute('**/api/account');
  expect((await (await page.request.get('/api/account')).json()).balances).toEqual(before.balances);
});

test('missing rupiah rates show unavailable and can be retried without changing mode', async ({
  page,
}) => {
  await page.route('**/api/exchange-rate', (route) =>
    route.fulfill({ status: 503, json: { error: 'Unavailable' } }),
  );
  await openWallet(page);
  await page.getByLabel('Total assets currency').selectOption('IDR');
  await expect(page.locator('.wallet-rate')).toContainText('Rupiah rate unavailable');
  await expect(page.getByLabel('Total assets value')).toHaveText('— IDR');
  await page.route('**/api/exchange-rate', (route) =>
    route.fulfill({ json: { ...rate, cached: true } }),
  );
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByLabel('Total assets value')).toHaveText('Rp 0 IDR');
  await expect(page.locator('.wallet-rate')).toContainText('Cached rate');
});

test('unavailable market valuation never displays a partial total', async ({ page }) => {
  await page.route('**/api/exchange-rate', (route) => route.fulfill({ json: rate }));
  await openWallet(page);
  const before = await (await page.request.get('/api/account')).json();
  await page.route('**/api/account', (route) =>
    route.fulfill({ json: { ...before, equity: null } }),
  );
  await page.reload();
  await expect(page.getByLabel('Total assets value')).toHaveText('— USD');
  await expect(page.getByText('Waiting for fresh asset prices.')).toBeVisible();
  await page.getByLabel('Total assets currency').selectOption('IDR');
  await expect(page.getByLabel('Total assets value')).toHaveText('— IDR');
});
