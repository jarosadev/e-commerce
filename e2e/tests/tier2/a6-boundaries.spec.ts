import { expect, test } from '@playwright/test';
import { SEED_PRODUCTS, SEED_TENANTS } from '../../src/config/env';
import {
  attachBrowserGuard,
  buildFrontendUrl,
  buildSubdomainFrontendUrl,
} from '../../src/helpers/browser-helpers';

test.describe('Tier 2 — A6: Frontend Boundary, Routing & Error Resilience', () => {
  test('T2.A6.1 Unknown store path /store/unknown-store-404 returns clean 404 without leaking catalog', async ({ page }) => {
    const guard = attachBrowserGuard(page);
    const res = await page.goto(buildFrontendUrl('/store/unknown-store-e2e-404'), {
      waitUntil: 'domcontentloaded',
    });
    const status = res?.status() ?? 0;
    expect(status).toBeLessThan(500);
    expect([404, 200]).toContain(status);

    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toContain(SEED_TENANTS.modaMayorista.name);
    expect(bodyText).not.toContain(SEED_TENANTS.electroHogar.name);
    if (status !== 404) {
      expect(bodyText).toMatch(/404|no encontrad|not found/i);
    }
    guard.assertClean();
  });

  test('T2.A6.2 Unknown subdomain http://unknown-tenant-e2e.localhost:3000 renders cleanly without leaking tenant catalog', async ({ page }) => {
    const guard = attachBrowserGuard(page);
    const res = await page.goto(buildSubdomainFrontendUrl('unknown-tenant-e2e', '/'), {
      waitUntil: 'domcontentloaded',
    });
    const status = res?.status() ?? 0;
    expect(status).toBeLessThan(500);
    expect([200, 404]).toContain(status);

    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toContain(SEED_TENANTS.modaMayorista.name);
    expect(bodyText).not.toContain(SEED_TENANTS.electroHogar.name);
    expect(bodyText).not.toContain(SEED_PRODUCTS.hoodie.name);
    if (status === 200) {
      expect(bodyText).toMatch(/404|no encontrad|not found|vendexa|planes|tienda|comenzar/i);
    }
    guard.assertClean();
  });

  test('T2.A6.3 /api/auth/exchange with missing or invalid code rejects safely without setting access_token', async ({ request }) => {
    const allowedFailStatuses = [302, 303, 307, 308, 400, 401, 404];

    const missingCodeRes = await request.get(buildFrontendUrl('/api/auth/exchange'), {
      maxRedirects: 0,
    });
    expect(allowedFailStatuses).toContain(missingCodeRes.status());
    const missingSetCookies = missingCodeRes
      .headersArray()
      .filter((h) => h.name.toLowerCase() === 'set-cookie')
      .map((h) => h.value)
      .join('\n');
    expect(missingSetCookies).not.toContain('access_token=');

    const invalidCodeRes = await request.get(
      buildFrontendUrl('/api/auth/exchange?code=invalid-e2e-code'),
      { maxRedirects: 0 },
    );
    expect(allowedFailStatuses).toContain(invalidCodeRes.status());
    const invalidSetCookies = invalidCodeRes
      .headersArray()
      .filter((h) => h.name.toLowerCase() === 'set-cookie')
      .map((h) => h.value)
      .join('\n');
    expect(invalidSetCookies).not.toContain('access_token=');
  });

  test('T2.A6.4 Invalid credentials on /login show error feedback without pageerror or 5xx', async ({ page }) => {
    const guard = attachBrowserGuard(page, {
      ignoreConsolePatterns: [/400|401|403/, /Failed to load resource/i],
    });
    await page.goto(buildFrontendUrl('/login'), { waitUntil: 'networkidle' });

    await page.locator('input[type="email"], input[name="email"]').first().fill('wrong@vendexa.local');
    await page.locator('input[type="password"], input[name="password"]').first().fill('WrongPass123!');

    const submitBtn = page.locator('button[type="submit"]').first();
    const [loginRes] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.request().method() === 'POST' &&
          (res.url().includes('/auth/') || res.url().includes('/login')),
        { timeout: 15_000 },
      ),
      submitBtn.click(),
    ]);
    expect([400, 401, 403]).toContain(loginRes.status());

    await expect(page).toHaveURL(/\/login/);
    const alertLocator = page.locator('[role="alert"]');
    const errorTextLocator = page.getByText(/inválid|invalido|incorrect|unauthorized|error|credencial|failed/i);
    await expect(alertLocator.or(errorTextLocator).first()).toBeVisible({ timeout: 10_000 });
    guard.assertClean();
  });

  test('T2.A6.5 Auth recovery & verification routes (/verify-otp, /forgot-password, /reset-password) render without 500', async ({ page }) => {
    const guard = attachBrowserGuard(page);

    for (const route of ['/verify-otp', '/forgot-password', '/reset-password']) {
      const res = await page.goto(buildFrontendUrl(route), { waitUntil: 'domcontentloaded' });
      expect(res?.status(), `${route} returned >= 500`).toBeLessThan(500);
    }

    guard.assertClean();
  });
});
