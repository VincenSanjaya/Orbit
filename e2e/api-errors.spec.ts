import { test, expect } from '@playwright/test';

test('login explains an offline HTML backend response without showing a JSON parser error', async ({
  page,
}) => {
  await page.route('**/api/auth/login', (route) =>
    route.fulfill({
      status: 502,
      contentType: 'text/html',
      body: '<!DOCTYPE html><html><body>The ngrok endpoint is offline.</body></html>',
    }),
  );
  await page.goto('/login');
  await page.getByLabel('Email address').fill('api-outage@orbit.test');
  await page.getByLabel('Password', { exact: true }).fill('api-outage-test-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByText(
      'Could not connect to ORBIT’s API. Check the local server, ngrok, and backend URL in Vercel.',
    ),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
  await expect(page).toHaveURL('/login');
});

test('login keeps a valid API authentication error intact', async ({ page }) => {
  await page.route('**/api/auth/login', (route) =>
    route.fulfill({
      status: 401,
      json: { error: 'Email or password is incorrect.' },
    }),
  );
  await page.goto('/login');
  await page.getByLabel('Email address').fill('api-outage@orbit.test');
  await page.getByLabel('Password', { exact: true }).fill('api-outage-test-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('Email or password is incorrect.')).toBeVisible();
});
