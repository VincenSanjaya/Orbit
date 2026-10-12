import { test, expect } from '@playwright/test';

test.skip(!process.env.E2E_NGROK, 'Requires a web proxy connected to a running ngrok tunnel.');

test('browser API and EventSource reach the local backend through ngrok without its warning page', async ({
  page,
}) => {
  await page.goto('/markets');
  const session = await page.evaluate(async () => {
    const response = await fetch('/api/session');
    return {
      status: response.status,
      type: response.headers.get('content-type'),
      body: await response.json(),
    };
  });
  expect(session.status).toBe(200);
  expect(session.type).toContain('application/json');
  expect(session.body).toEqual({ user: null });
  await expect(page.locator('.market-table tbody tr')).toHaveCount(16);
  const events = await page.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const values: string[] = [];
        const source = new EventSource(
          `/api/market/stream?symbol=HYPE&timeframe=15m&mode=live&clientId=${crypto.randomUUID()}`,
        );
        const timer = setTimeout(() => {
          source.close();
          reject(new Error('No ngrok SSE events received.'));
        }, 20000);
        source.onmessage = (event) => {
          values.push(JSON.parse(event.data).source);
          if (values.length === 2) {
            clearTimeout(timer);
            source.close();
            resolve(values);
          }
        };
        source.onerror = () => {
          clearTimeout(timer);
          source.close();
          reject(new Error('ngrok EventSource disconnected.'));
        };
      }),
  );
  expect(events).toEqual(['live', 'live']);
  const denied = await page.request.post('/api/wallet/faucet', {
    data: {},
    headers: { origin: 'https://attacker.invalid' },
  });
  expect(denied.status()).toBe(403);
});
