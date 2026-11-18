import { expect, test } from '@playwright/test';
import {
  ENDPOINTS,
  ENV,
  SEED_COUPONS,
  SEED_PLANS,
  SEED_PRODUCTS,
  SEED_TENANTS,
  SEED_USERS,
  uniqueEmail,
  uniqueId,
  uniqueSlug,
} from '../../src/config/env';
import {
  assertOpenApi3Document,
  extractArray,
  extractData,
  isRecord,
  type JsonRecord,
} from '../../src/helpers/assertions';
import {
  attachBrowserGuard,
  buildFrontendUrl,
  loginViaUi,
} from '../../src/helpers/browser-helpers';
import { HttpClient } from '../../src/helpers/http-client';
import { MailpitClient } from '../../src/helpers/mailpit-client';
import {
  buildVerifyOtpPayload,
  createBackendClient,
  extractCartItemUnitPrice,
  extractCartView,
  fetchStorefrontProduct,
  getEntityId,
  getVariantBySku,
  loginPlatform,
  loginStoreCustomer,
  registerAndVerifyPlatformOwner,
} from '../../src/helpers/workflows';

test.describe('Tier 4 — Real-World End-to-End User Journeys', () => {
  test('T4.J1 New SaaS Merchant discovers plans on /, registers, verifies OTP via Mailpit, creates store, and accesses /dashboard', async ({ page }) => {
    const guard = attachBrowserGuard(page);

    // 1. Discover SaaS plans on public landing page
    const landingRes = await page.goto(buildFrontendUrl('/'), { waitUntil: 'networkidle' });
    expect(landingRes?.status()).toBe(200);
    await expect(page.locator('body')).toContainText('19');
    await expect(page.locator('body')).toContainText('49');

    // 2. Register merchant + verify OTP via Mailpit
    const email = uniqueEmail('j1-merchant');
    const password = 'JourneyOwner123!';
    const api = createBackendClient();
    const mailpit = new MailpitClient();
    const startedAt = Date.now();

    const regRes = await api.post('/auth/platform/register', {
      email,
      password,
      fullName: 'Valeria Journey Merchant',
    });
    expect(regRes.status).toBe(201);

    const otpMsg = await mailpit.waitForEmail({ to: email, afterMs: startedAt, timeoutMs: 20_000 });
    const otp = mailpit.extractOtpCode(otpMsg);
    const verifyRes = await api.post(
      '/auth/platform/verify-otp',
      await buildVerifyOtpPayload(email, otp),
    );
    expect([200, 201]).toContain(verifyRes.status);

    // 3. Log in and onboard store
    await loginPlatform(email, password, api);
    const slug = uniqueSlug('valeria-shop');
    const tenantRes = await api.post<JsonRecord>('/tenants', {
      name: `Valeria Shop ${slug}`,
      slug,
      currency: 'USD',
      planCode: SEED_PLANS.CRECIMIENTO_PRO.code,
    });
    expect(tenantRes.status).toBe(201);

    // 4. Sign in via Frontend /login and open /dashboard
    await loginViaUi(page, {
      email,
      password,
      targetPath: '/dashboard',
    });
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await expect(page.locator('body')).toContainText(
      new RegExp(`Valeria|${slug}|Dashboard|Panel|Tienda`, 'i'),
    );
    guard.assertClean();
  });

  test('T4.J2 SuperAdmin reviews new merchant in CRM, updates internal notes, creates & approves manual payment', async ({ page }) => {
    const guard = attachBrowserGuard(page);

    // 1. Create fresh merchant & store
    const { client: owner, email: merchantEmail } = await registerAndVerifyPlatformOwner({
      fullName: 'Mateo CRM Journey',
    });
    const slug = uniqueSlug('mateo-store');
    const tenantRes = await owner.post<JsonRecord>('/tenants', {
      name: `Mateo Store ${slug}`,
      slug,
      planCode: SEED_PLANS.CRECIMIENTO_PRO.code,
    });
    expect(tenantRes.status).toBe(201);
    const tenantData = extractData<JsonRecord>(tenantRes.body);
    const tenantId = getEntityId(tenantData);
    const subscriptionId =
      isRecord(tenantData.subscription) ? String(tenantData.subscription.id ?? '') : '';

    // 2. SuperAdmin logs into UI and opens /superadmin
    await loginViaUi(page, {
      email: SEED_USERS.superAdmin.email,
      password: SEED_USERS.superAdmin.password,
      targetPath: '/superadmin',
    });
    await expect(page).toHaveURL(/\/superadmin/);
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.locator('body')).toContainText(/Urban Threads|Carlos|ElectroHogar|Mateo/i);

    // 3. SuperAdmin inspects client fiche, updates internalAdminNotes, creates & approves manual payment
    const { client: admin } = await loginPlatform(
      SEED_USERS.superAdmin.email,
      SEED_USERS.superAdmin.password,
    );
    const clients = extractArray<JsonRecord>(
      (await admin.get(`/platform-admin/clients?search=${encodeURIComponent(merchantEmail)}`)).body,
    );
    const merchant = clients.find(
      (c) => c.email === merchantEmail || (isRecord(c.user) && c.user.email === merchantEmail),
    );
    expect(merchant).toBeDefined();
    const ownerId = String(
      merchant?.id ?? merchant?.userId ?? (isRecord(merchant?.user) ? merchant.user.id : ''),
    );

    const noteText = `Verificado transferencia bancaria ${uniqueId('note')}`;
    const patchNote = await admin.patch(`/platform-admin/clients/${ownerId}`, {
      internalAdminNotes: noteText,
    });
    expect(patchNote.status).toBe(200);

    const mailpit = new MailpitClient();
    const startedAt = Date.now();
    const payBody: Record<string, unknown> = {
      tenantId,
      provider: 'MANUAL_TRANSFER',
      amount: 49,
      currency: 'USD',
      externalReference: `TRF-${uniqueId('j2').toUpperCase()}`,
    };
    if (subscriptionId) {
      payBody.subscriptionId = subscriptionId;
    }

    const payRes = await admin.post<JsonRecord>('/platform-admin/payments', payBody);
    expect(payRes.status).toBe(201);
    const paymentId = getEntityId(extractData<JsonRecord>(payRes.body));

    const reviewRes = await admin.patch<JsonRecord>(
      `/platform-admin/payments/${paymentId}/review`,
      { reviewStatus: 'APPROVED' },
    );
    expect(reviewRes.status).toBe(200);
    expect(extractData<JsonRecord>(reviewRes.body).reviewStatus).toBe('APPROVED');

    // Confirm merchant tenant is ACTIVE and confirmation email arrived in Mailpit
    const resolved = extractData<JsonRecord>(
      (await createBackendClient().get('/tenants/resolve', { tenantSlug: slug })).body,
    );
    expect(resolved.status).toBe('ACTIVE');

    const confirmation = await mailpit.waitForEmail({
      to: merchantEmail,
      afterMs: startedAt,
      timeoutMs: 20_000,
    });
    expect(confirmation.Subject.length).toBeGreaterThan(0);

    guard.assertClean();
  });

  test('T4.J3 B2B Wholesale Buyer browses moda-mayorista, adds tiered qty to guest cart, logs in, merges, hits 12+ tier & applies BIENVENIDA10', async ({ page }) => {
    const guard = attachBrowserGuard(page);

    // 1. Browse Storefront UI
    const storeRes = await page.goto(buildFrontendUrl(`/store/${SEED_TENANTS.modaMayorista.slug}`), {
      waitUntil: 'networkidle',
    });
    expect(storeRes?.status()).toBe(200);
    await expect(page.locator('body')).toContainText(SEED_TENANTS.modaMayorista.name);
    await expect(page.locator('body')).toContainText(SEED_PRODUCTS.hoodie.name);

    // 2. Clean seeded customer cart before journey
    const { client: cleanClient } = await loginStoreCustomer(
      SEED_USERS.customer1.email,
      SEED_USERS.customer1.password,
      SEED_TENANTS.modaMayorista.slug,
    );
    await cleanClient.delete('/cart', { tenantSlug: SEED_TENANTS.modaMayorista.slug });

    // 3. Guest adds 5 hoodies ($42 retail = $210)
    const product = await fetchStorefrontProduct(
      SEED_PRODUCTS.hoodie.slug,
      SEED_TENANTS.modaMayorista.slug,
    );
    const variantId = String(getVariantBySku(product, SEED_PRODUCTS.hoodie.skus.blkM).id);

    const buyerClient = createBackendClient();
    const guestAdd = await buyerClient.post<JsonRecord>(
      '/cart/items',
      { variantId, quantity: 5 },
      { tenantSlug: SEED_TENANTS.modaMayorista.slug },
    );
    expect([200, 201]).toContain(guestAdd.status);
    expect(extractCartItemUnitPrice(extractCartView(guestAdd.body).items[0] as JsonRecord)).toBe(42);

    try {
      // 4. Log in as comprador@cliente.local and merge cart
      await loginStoreCustomer(
        SEED_USERS.customer1.email,
        SEED_USERS.customer1.password,
        SEED_TENANTS.modaMayorista.slug,
        buyerClient,
      );
      let cart = extractCartView(
        (await buyerClient.get('/cart', { tenantSlug: SEED_TENANTS.modaMayorista.slug })).body,
      );
      if (cart.items.length === 0) {
        const merge = await buyerClient.post(
          '/cart/merge',
          {},
          { tenantSlug: SEED_TENANTS.modaMayorista.slug },
        );
        expect([200, 201]).toContain(merge.status);
        cart = extractCartView(merge.body);
      }
      expect(Number(cart.items[0]?.quantity)).toBe(5);

      // 5. Add 7 more units -> total 12 units hits top wholesale tier $26.50 ($318.00)
      const addTier2 = await buyerClient.post<JsonRecord>(
        '/cart/items',
        { variantId, quantity: 7 },
        { tenantSlug: SEED_TENANTS.modaMayorista.slug },
      );
      expect([200, 201]).toContain(addTier2.status);
      const wholesaleCart = extractCartView(addTier2.body);
      expect(Number(wholesaleCart.items[0]?.quantity)).toBe(12);
      expect(extractCartItemUnitPrice(wholesaleCart.items[0] as JsonRecord)).toBe(26.5);
      expect(wholesaleCart.subtotal).toBe(318);

      // 6. Validate coupon BIENVENIDA10 (10% of $318 = $31.80)
      const couponRes = await buyerClient.post<JsonRecord>(
        '/storefront/coupons/validate',
        { code: SEED_COUPONS.bienvenida10.code, subtotal: wholesaleCart.subtotal },
        { tenantSlug: SEED_TENANTS.modaMayorista.slug },
      );
      expect(couponRes.status).toBe(200);
      const couponData = extractData<JsonRecord>(couponRes.body);
      expect(couponData.valid).toBe(true);
      expect(Number(couponData.discountAmount)).toBeCloseTo(31.8, 2);
    } finally {
      await buyerClient.delete('/cart', { tenantSlug: SEED_TENANTS.modaMayorista.slug });
    }

    guard.assertClean();
  });

  test('T4.J4 Complete Store Isolation across moda-mayorista vs electro-hogar (UI + API themes, products, customers, carts)', async ({ page }) => {
    const guard = attachBrowserGuard(page);

    // 1. UI isolation check
    await page.goto(buildFrontendUrl(`/store/${SEED_TENANTS.modaMayorista.slug}`), {
      waitUntil: 'networkidle',
    });
    await expect(page.locator('body')).toContainText(SEED_TENANTS.modaMayorista.name);
    await expect(page.locator('body')).toContainText(SEED_PRODUCTS.hoodie.name);

    await page.goto(buildFrontendUrl(`/store/${SEED_TENANTS.electroHogar.slug}`), {
      waitUntil: 'networkidle',
    });
    const electroText = await page.locator('body').innerText();
    expect(electroText).toContain(SEED_TENANTS.electroHogar.name);
    expect(electroText).not.toContain(SEED_PRODUCTS.hoodie.name);

    // 2. API host isolation check
    const api = createBackendClient();
    const modaConfig = extractData<JsonRecord>(
      (await api.get('/storefront/config', { tenantHost: SEED_TENANTS.modaMayorista.host })).body,
    );
    const electroConfig = extractData<JsonRecord>(
      (await api.get('/storefront/config', { tenantHost: SEED_TENANTS.electroHogar.host })).body,
    );
    expect(JSON.stringify(modaConfig)).toContain(SEED_TENANTS.modaMayorista.theme.primaryColor);
    expect(JSON.stringify(electroConfig)).toContain(SEED_TENANTS.electroHogar.theme.primaryColor);

    const modaProds = extractArray<JsonRecord>(
      (await api.get('/storefront/products', { tenantHost: SEED_TENANTS.modaMayorista.host })).body,
    );
    const electroProds = extractArray<JsonRecord>(
      (await api.get('/storefront/products', { tenantHost: SEED_TENANTS.electroHogar.host })).body,
    );
    expect(modaProds.length).toBeGreaterThanOrEqual(3);
    expect(electroProds.length).toBe(0);

    guard.assertClean();
  });

  test('T4.J5 Local Google OAuth non-blocking behavior + Frontend OpenAPI connectivity check', async ({ page, request }) => {
    const guard = attachBrowserGuard(page);

    // 1. OpenAPI contract check
    const rootClient = new HttpClient({ baseUrl: ENV.backendUrl });
    const openApiRes = await rootClient.get('/api/docs-json');
    expect(openApiRes.status).toBe(200);
    assertOpenApi3Document(openApiRes.body);

    // 2. Auth capabilities check (non-blocking local fallback)
    const capsRes = await new HttpClient({ baseUrl: ENDPOINTS.apiBaseUrl }).get<JsonRecord>('/auth/capabilities');
    expect(capsRes.status).toBe(200);
    const caps = extractData<JsonRecord>(capsRes.body);
    expect(['oauth', 'local-fallback']).toContain(caps.mode);

    // 3. Exchange route handles invalid code gracefully without 500 or setting access_token
    const exchangeCheck = await request.get(buildFrontendUrl('/api/auth/exchange?code=nonexistent'), {
      maxRedirects: 0,
    });
    expect([302, 303, 307, 308, 400, 401, 404]).toContain(exchangeCheck.status());
    const exchangeSetCookies = exchangeCheck
      .headersArray()
      .filter((h) => h.name.toLowerCase() === 'set-cookie')
      .map((h) => h.value)
      .join('\n');
    expect(exchangeSetCookies).not.toContain('access_token=');

    // 4. Local login on /login works smoothly without Google OAuth blocking
    await loginViaUi(page, {
      email: SEED_USERS.owner1.email,
      password: SEED_USERS.owner1.password,
      targetPath: '/dashboard',
    });
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await expect(page.locator('body')).toContainText(
      /Urban Threads|moda-mayorista|Carlos|Dashboard|Panel|Tienda/i,
    );

    guard.assertClean();
  });
});
