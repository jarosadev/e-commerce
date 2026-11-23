import { expect, test } from '@playwright/test';
import {
  SEED_PLANS,
  SEED_PRODUCTS,
  SEED_TENANTS,
  SEED_USERS,
} from '../../src/config/env';
import {
  attachBrowserGuard,
  buildFrontendUrl,
  buildSubdomainFrontendUrl,
  loginViaUi,
} from '../../src/helpers/browser-helpers';

test.describe('Tier 1 — A6: Frontend Next.js SSR/UI Routes & Subdomain Routing', () => {
  test('T1.A6.1 Landing page / renders HTTP 200 with SaaS plans and zero runtime errors', async ({ page }) => {
    const guard = attachBrowserGuard(page);
    const res = await page.goto(buildFrontendUrl('/'), { waitUntil: 'networkidle' });
    expect(res?.status()).toBe(200);

    const bodyText = await page.locator('body').innerText();
    expect(bodyText.length).toBeGreaterThan(20);
    expect(bodyText).toContain(SEED_PLANS.EMPRENDEDOR.priceMonthly.toString());
    expect(bodyText).toContain(SEED_PLANS.CRECIMIENTO_PRO.priceMonthly.toString());
    guard.assertClean();
  });

  test('T1.A6.2 Auth pages /login and /register render interactive forms cleanly', async ({ page }) => {
    const guard = attachBrowserGuard(page);

    const loginRes = await page.goto(buildFrontendUrl('/login'), { waitUntil: 'networkidle' });
    expect(loginRes?.status()).toBe(200);
    await expect(page.locator('input[type="email"], input[name="email"]').first()).toBeVisible();
    await expect(page.locator('input[type="password"], input[name="password"]').first()).toBeVisible();

    const registerRes = await page.goto(buildFrontendUrl('/register'), { waitUntil: 'networkidle' });
    expect(registerRes?.status()).toBe(200);
    await expect(page.locator('input[type="email"], input[name="email"]').first()).toBeVisible();

    guard.assertClean();
  });

  test('T1.A6.3 Storefront path fallback /store/moda-mayorista renders Urban Threads catalog', async ({ page }) => {
    const guard = attachBrowserGuard(page);
    const res = await page.goto(buildFrontendUrl(`/store/${SEED_TENANTS.modaMayorista.slug}`), {
      waitUntil: 'networkidle',
    });
    expect(res?.status()).toBe(200);

    const body = page.locator('body');
    await expect(body).toContainText(SEED_TENANTS.modaMayorista.name);
    await expect(body).toContainText(SEED_PRODUCTS.hoodie.name);
    guard.assertClean();
  });

  test('T1.A6.4 Storefront path fallback /store/electro-hogar renders isolated store cleanly', async ({ page }) => {
    const guard = attachBrowserGuard(page);
    const res = await page.goto(buildFrontendUrl(`/store/${SEED_TENANTS.electroHogar.slug}`), {
      waitUntil: 'networkidle',
    });
    expect(res?.status()).toBe(200);

    const bodyText = await page.locator('body').innerText();
    expect(bodyText).toContain(SEED_TENANTS.electroHogar.name);
    expect(bodyText).not.toContain(SEED_PRODUCTS.hoodie.name);
    guard.assertClean();
  });

  test('T1.A6.5 Subdomain host routing http://moda-mayorista.localhost:3000 resolves storefront via middleware', async ({ page }) => {
    const guard = attachBrowserGuard(page);
    const res = await page.goto(buildSubdomainFrontendUrl(SEED_TENANTS.modaMayorista.slug, '/'), {
      waitUntil: 'networkidle',
    });
    expect(res?.status()).toBe(200);

    await expect(page.locator('body')).toContainText(SEED_TENANTS.modaMayorista.name);
    await expect(page.locator('body')).toContainText(SEED_PRODUCTS.hoodie.name);
    guard.assertClean();
  });

  test('T1.A6.6 Protected panels /superadmin and /dashboard handle unauthenticated visits safely without leaking data', async ({ page }) => {
    const guard = attachBrowserGuard(page, {
      ignoreConsolePatterns: [/401/, /403/, /Failed to load resource/i],
    });

    for (const protectedPath of ['/superadmin', '/dashboard']) {
      const res = await page.goto(buildFrontendUrl(protectedPath), { waitUntil: 'networkidle' });
      const status = res?.status() ?? 0;
      expect([200, 302, 303, 307, 308, 401, 403]).toContain(status);

      if (status !== 401 && status !== 403) {
        await page.waitForURL(/\/login/, { timeout: 5_000 }).catch(() => undefined);
        await expect(page).toHaveURL(/\/login/);
        await expect(page.locator('input[type="email"], input[name="email"]').first()).toBeVisible();
      }

      const bodyText = await page.locator('body').innerText();
      expect(bodyText).not.toContain(SEED_TENANTS.modaMayorista.name);
      expect(bodyText).not.toContain(SEED_USERS.owner1.email);
    }

    guard.assertClean();
  });

  test('T1.A6.7 Authenticated SuperAdmin loads /superadmin CRM with seeded client data', async ({ page }) => {
    const guard = attachBrowserGuard(page);

    await loginViaUi(page, {
      email: SEED_USERS.superAdmin.email,
      password: SEED_USERS.superAdmin.password,
      targetPath: '/superadmin',
    });

    await expect(page).toHaveURL(/\/superadmin/);
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.locator('body')).toContainText(/Urban Threads|Carlos|ElectroHogar/i);
    guard.assertClean();
  });
});
