import { expect, test } from '@playwright/test';
import {
  ENDPOINTS,
  SEED_PLANS,
  SEED_PRODUCTS,
  SEED_TENANTS,
  SEED_USERS,
  uniqueEmail,
  uniqueId,
  uniqueSlug,
} from '../../src/config/env';
import {
  assertRfc7807Error,
  extractArray,
  extractData,
  isRecord,
  type JsonRecord,
} from '../../src/helpers/assertions';
import {
  attachBrowserGuard,
  buildFrontendUrl,
  buildSubdomainFrontendUrl,
} from '../../src/helpers/browser-helpers';
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
  registerAndVerifyStoreCustomer,
} from '../../src/helpers/workflows';

test.describe('Tier 3 — Cross-Feature Pairwise Combinations (A1–A6)', () => {
  test('T3.P1 (A2×A5) Guest cart + Store register + Mailpit OTP + login merge + B2B tier recalculation', async () => {
    const product = await fetchStorefrontProduct(
      SEED_PRODUCTS.hoodie.slug,
      SEED_TENANTS.modaMayorista.slug,
    );
    const variantId = String(getVariantBySku(product, SEED_PRODUCTS.hoodie.skus.blkM).id);

    // 1. Guest adds 4 units at retail $42
    const client = createBackendClient();
    const guestAdd = await client.post<JsonRecord>(
      '/cart/items',
      { variantId, quantity: 4 },
      { tenantSlug: SEED_TENANTS.modaMayorista.slug },
    );
    expect([200, 201]).toContain(guestAdd.status);
    expect(extractCartItemUnitPrice(extractCartView(guestAdd.body).items[0] as JsonRecord)).toBe(42);

    // 2. Register & verify new store customer via Mailpit in same tenant
    const email = uniqueEmail('t3-merge');
    const password = 'BuyerPairwise123!';
    const mailpit = new MailpitClient();
    const startedAt = Date.now();

    const reg = await client.post(
      '/auth/store/register',
      { email, password, fullName: 'Pairwise Buyer' },
      { tenantSlug: SEED_TENANTS.modaMayorista.slug },
    );
    expect(reg.status).toBe(201);

    const msg = await mailpit.waitForEmail({ to: email, afterMs: startedAt, timeoutMs: 20_000 });
    const otp = mailpit.extractOtpCode(msg);
    const verifyRes = await client.post(
      '/auth/store/verify-otp',
      await buildVerifyOtpPayload(email, otp),
      { tenantSlug: SEED_TENANTS.modaMayorista.slug },
    );
    expect([200, 201]).toContain(verifyRes.status);

    // 3. Login carrying guest_cart_token cookie
    await loginStoreCustomer(email, password, SEED_TENANTS.modaMayorista.slug, client);
    let cart = extractCartView(
      (await client.get('/cart', { tenantSlug: SEED_TENANTS.modaMayorista.slug })).body,
    );
    if (cart.items.length === 0) {
      const merge = await client.post('/cart/merge', {}, { tenantSlug: SEED_TENANTS.modaMayorista.slug });
      expect([200, 201]).toContain(merge.status);
      cart = extractCartView(merge.body);
    }
    expect(cart.items.length).toBe(1);
    expect(Number(cart.items[0]?.quantity)).toBe(4);

    // 4. Add 2 more units -> total 6 triggers B2B tier $33.00
    const addMore = await client.post<JsonRecord>(
      '/cart/items',
      { variantId, quantity: 2 },
      { tenantSlug: SEED_TENANTS.modaMayorista.slug },
    );
    expect([200, 201]).toContain(addMore.status);
    const updatedCart = extractCartView(addMore.body);
    expect(Number(updatedCart.items[0]?.quantity)).toBe(6);
    expect(extractCartItemUnitPrice(updatedCart.items[0] as JsonRecord)).toBe(33);
    expect(updatedCart.subtotal).toBe(198);
  });

  test('T3.P2 (A1×A4×A5×A6) Suspend tenant invalidates cache across API & SSR, then reactivating restores access', async ({ page }) => {
    const guard = attachBrowserGuard(page, {
      ignoreConsolePatterns: [/403|404/, /Failed to load resource/i],
    });
    const { client: owner } = await registerAndVerifyPlatformOwner();
    const slug = uniqueSlug('t3-suspend');
    const createRes = await owner.post<JsonRecord>('/tenants', {
      name: `Pairwise Suspend ${slug}`,
      slug,
      planCode: SEED_PLANS.EMPRENDEDOR.code,
    });
    expect(createRes.status).toBe(201);
    const tenantId = getEntityId(extractData<JsonRecord>(createRes.body));

    // Warm API cache and verify SSR page loads 200
    expect((await createBackendClient().get('/storefront/config', { tenantSlug: slug })).status).toBe(200);
    const ssrActive = await page.goto(buildFrontendUrl(`/store/${slug}`), { waitUntil: 'domcontentloaded' });
    expect(ssrActive?.status()).toBe(200);

    // SuperAdmin suspends tenant
    const { client: admin } = await loginPlatform(
      SEED_USERS.superAdmin.email,
      SEED_USERS.superAdmin.password,
    );
    expect(
      (await admin.patch(`/platform-admin/tenants/${tenantId}/status`, { status: 'SUSPENDED' })).status,
    ).toBe(200);

    // API returns 403; SSR returns 403/404 or displays suspended/unavailable notice without active catalog
    assertRfc7807Error(
      await createBackendClient().get('/storefront/config', { tenantSlug: slug }),
      403,
    );
    const ssrSuspended = await page.goto(buildFrontendUrl(`/store/${slug}`), { waitUntil: 'domcontentloaded' });
    const suspendedStatus = ssrSuspended?.status() ?? 0;
    expect(suspendedStatus).toBeLessThan(500);
    if (![403, 404].includes(suspendedStatus)) {
      const suspendedBody = await page.locator('body').innerText();
      expect(suspendedBody).toMatch(/suspend|no disponible|unavailable|inactiv|403|404|not found/i);
      expect(suspendedBody).not.toMatch(/agregar al carrito|add to cart/i);
    }

    // Reactivate tenant -> API 200 & SSR 200
    expect(
      (await admin.patch(`/platform-admin/tenants/${tenantId}/status`, { status: 'ACTIVE' })).status,
    ).toBe(200);
    expect((await createBackendClient().get('/storefront/config', { tenantSlug: slug })).status).toBe(200);
    const ssrRestored = await page.goto(buildFrontendUrl(`/store/${slug}`), { waitUntil: 'domcontentloaded' });
    expect(ssrRestored?.status()).toBe(200);
    guard.assertClean();
  });

  test('T3.P3 (A2×A3×A4) New merchant onboarding + manual payment approval activates subscription & sends Mailpit email', async () => {
    const { client: owner, email: ownerEmail } = await registerAndVerifyPlatformOwner();
    const slug = uniqueSlug('t3-onboard-pay');
    const tenantRes = await owner.post<JsonRecord>('/tenants', {
      name: `Onboard Pay ${slug}`,
      slug,
      planCode: SEED_PLANS.CRECIMIENTO_PRO.code,
    });
    expect(tenantRes.status).toBe(201);
    const tenantData = extractData<JsonRecord>(tenantRes.body);
    const tenantId = getEntityId(tenantData);
    const subscriptionId =
      isRecord(tenantData.subscription) ? String(tenantData.subscription.id ?? '') : '';

    const { client: admin } = await loginPlatform(
      SEED_USERS.superAdmin.email,
      SEED_USERS.superAdmin.password,
    );
    const mailpit = new MailpitClient();
    const startedAt = Date.now();

    const payBody: Record<string, unknown> = {
      tenantId,
      provider: 'MANUAL_TRANSFER',
      amount: 49,
      currency: 'USD',
      externalReference: `TRF-${uniqueId('p3').toUpperCase()}`,
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

    // Tenant should now resolve as ACTIVE
    const resolved = extractData<JsonRecord>(
      (await createBackendClient().get<JsonRecord>('/tenants/resolve', { tenantSlug: slug })).body,
    );
    expect(resolved.status).toBe('ACTIVE');

    const confirmationEmail = await mailpit.waitForEmail({
      to: ownerEmail,
      afterMs: startedAt,
      timeoutMs: 20_000,
    });
    expect(confirmationEmail.ID).toBeTruthy();
  });

  test('T3.P4 (A1×A3×A5×A6) Onboard tenant + update StoreTheme -> API & Chromium SSR reflect branding immediately', async ({ page }) => {
    const guard = attachBrowserGuard(page);
    const { client: owner } = await registerAndVerifyPlatformOwner();
    const slug = uniqueSlug('t3-theme');
    const createRes = await owner.post<JsonRecord>('/tenants', {
      name: `Theme Brand ${slug}`,
      slug,
      planCode: SEED_PLANS.EMPRENDEDOR.code,
    });
    expect(createRes.status).toBe(201);

    const newHero = `Hero Pairwise ${slug}`;
    const patchRes = await owner.patch<JsonRecord>(
      '/tenants/current/theme',
      {
        primaryColor: '#1E293B',
        accentColor: '#EC4899',
        heroTitle: newHero,
      },
      { tenantSlug: slug },
    );
    expect(patchRes.status).toBe(200);

    const configRes = await createBackendClient().get<JsonRecord>('/storefront/config', {
      tenantHost: `${slug}.localhost:3000`,
    });
    expect(configRes.status).toBe(200);
    expect(JSON.stringify(configRes.body)).toContain('#EC4899');
    expect(JSON.stringify(configRes.body)).toContain(newHero);

    const uiRes = await page.goto(buildFrontendUrl(`/store/${slug}`), { waitUntil: 'networkidle' });
    expect(uiRes?.status()).toBe(200);
    await expect(page.locator('body')).toContainText(`Theme Brand ${slug}`);
    guard.assertClean();
  });

  test('T3.P5 (A1×A5×A6) Subdomain host routing + persistent cart state across reload', async ({ page }) => {
    const guard = attachBrowserGuard(page);
    const subdomainUrl = buildSubdomainFrontendUrl(SEED_TENANTS.modaMayorista.slug, '/');
    const res = await page.goto(subdomainUrl, { waitUntil: 'networkidle' });
    expect(res?.status()).toBe(200);
    await expect(page.locator('body')).toContainText(SEED_TENANTS.modaMayorista.name);
    await expect(page.locator('body')).toContainText(SEED_PRODUCTS.hoodie.name);

    const apiBaseUrl = ENDPOINTS.apiBaseUrl;
    const tenantHost = SEED_TENANTS.modaMayorista.host;

    try {
      // Try adding an item via storefront UI button first if rendered directly on the page
      const addBtn = page
        .getByRole('button', { name: /agregar al carrito|añadir al carrito|add to cart|agregar/i })
        .first();
      if ((await addBtn.count()) > 0 && (await addBtn.isVisible())) {
        await Promise.all([
          page
            .waitForResponse(
              (r) => r.url().includes('/cart') && ['POST', 'PATCH'].includes(r.request().method()),
              { timeout: 5_000 },
            )
            .catch(() => undefined),
          addBtn.click(),
        ]);
      }

      const fetchBrowserCart = async () => {
        return page.evaluate(
          async ({ baseUrl, host }) => {
            const response = await fetch(`${baseUrl}/cart`, {
              method: 'GET',
              credentials: 'include',
              headers: {
                Accept: 'application/json',
                'x-tenant-host': host,
              },
            });
            const body = (await response.json()) as unknown;
            return { status: response.status, body };
          },
          { baseUrl: apiBaseUrl, host: tenantHost },
        );
      };

      let beforeCartRes = await fetchBrowserCart();
      let beforeCart = extractCartView(beforeCartRes.body);

      if (beforeCart.items.length === 0) {
        const product = await fetchStorefrontProduct(
          SEED_PRODUCTS.hoodie.slug,
          SEED_TENANTS.modaMayorista.slug,
        );
        const variantId = String(getVariantBySku(product, SEED_PRODUCTS.hoodie.skus.blkM).id);
        const addResult = await page.evaluate(
          async ({ baseUrl, host, vId }) => {
            const response = await fetch(`${baseUrl}/cart/items`, {
              method: 'POST',
              credentials: 'include',
              headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                'x-tenant-host': host,
              },
              body: JSON.stringify({ variantId: vId, quantity: 2 }),
            });
            const body = (await response.json()) as unknown;
            return { status: response.status, body };
          },
          { baseUrl: apiBaseUrl, host: tenantHost, vId: variantId },
        );
        expect([200, 201]).toContain(addResult.status);
        beforeCartRes = await fetchBrowserCart();
        beforeCart = extractCartView(beforeCartRes.body);
      }

      expect(beforeCartRes.status).toBe(200);
      expect(beforeCart.items.length).toBeGreaterThanOrEqual(1);
      expect(beforeCart.totalQuantity).toBeGreaterThanOrEqual(1);

      const cookiesBefore = await page.context().cookies();
      const guestCookieBefore = cookiesBefore.find((c) => c.name === 'guest_cart_token');
      expect(guestCookieBefore, 'guest_cart_token cookie must exist before reload').toBeDefined();
      expect(guestCookieBefore?.value.length).toBeGreaterThan(0);

      // Reload the subdomain page and assert cart item, quantity, and cookie persist
      await page.reload({ waitUntil: 'networkidle' });
      await expect(page.locator('body')).toContainText(SEED_TENANTS.modaMayorista.name);
      await expect(page.locator('body')).toContainText(SEED_PRODUCTS.hoodie.name);

      const cookiesAfter = await page.context().cookies();
      const guestCookieAfter = cookiesAfter.find((c) => c.name === 'guest_cart_token');
      expect(guestCookieAfter?.value).toBe(guestCookieBefore?.value);

      const afterCartRes = await fetchBrowserCart();
      expect(afterCartRes.status).toBe(200);
      const afterCart = extractCartView(afterCartRes.body);
      expect(afterCart.items.length).toBe(beforeCart.items.length);
      expect(afterCart.totalQuantity).toBe(beforeCart.totalQuantity);
      expect(afterCart.subtotal).toBe(beforeCart.subtotal);
    } finally {
      await page
        .evaluate(
          async ({ baseUrl, host }) => {
            await fetch(`${baseUrl}/cart`, {
              method: 'DELETE',
              credentials: 'include',
              headers: { 'x-tenant-host': host },
            });
          },
          { baseUrl: apiBaseUrl, host: tenantHost },
        )
        .catch(() => undefined);
    }

    guard.assertClean();
  });

  test('T3.P6 (A3×A4) SuperAdmin creates plan, inspects CRM fiche & updates notes, then cleans up', async () => {
    const { client: admin } = await loginPlatform(
      SEED_USERS.superAdmin.email,
      SEED_USERS.superAdmin.password,
    );
    const planCode = `PAIRWISE_PLAN_${uniqueId('p6').toUpperCase().replace(/[^A-Z0-9_]/g, '_')}`;
    const planRes = await admin.post<JsonRecord>('/platform-admin/plans', {
      code: planCode,
      name: 'Plan Pairwise CRM',
      priceMonthly: 65,
      priceYearly: 650,
      maxProducts: 500,
      maxStaff: 2,
      isActive: true,
    });
    expect(planRes.status).toBe(201);
    const planId = getEntityId(extractData<JsonRecord>(planRes.body));

    let ownerId = '';
    let originalNotes = '';
    let notesUpdated = false;

    try {
      const clientsRes = await admin.get('/platform-admin/clients');
      expect(clientsRes.status).toBe(200);
      const clients = extractArray<JsonRecord>(clientsRes.body);
      const carlos = clients.find(
        (c) => c.email === SEED_USERS.owner1.email || (isRecord(c.user) && c.user.email === SEED_USERS.owner1.email),
      );
      expect(carlos).toBeDefined();
      ownerId = String(
        carlos?.id ?? carlos?.userId ?? (isRecord(carlos?.user) ? carlos.user.id : ''),
      );
      expect(ownerId.length).toBeGreaterThan(0);

      const ficheRes = await admin.get<JsonRecord>(`/platform-admin/clients/${ownerId}`);
      expect(ficheRes.status).toBe(200);
      expect(JSON.stringify(ficheRes.body)).toContain(SEED_TENANTS.modaMayorista.slug);

      const fiche = extractData<JsonRecord>(ficheRes.body);
      originalNotes = String(
        (isRecord(fiche.ownerProfile) ? fiche.ownerProfile.internalAdminNotes : undefined) ??
          fiche.internalAdminNotes ??
          '',
      );
      const updatedNote = `Pairwise CRM Note ${uniqueId('p6note')}`;
      const patchNoteRes = await admin.patch<JsonRecord>(`/platform-admin/clients/${ownerId}`, {
        internalAdminNotes: updatedNote,
      });
      expect(patchNoteRes.status, `PATCH client notes failed: ${patchNoteRes.rawText}`).toBe(200);
      notesUpdated = true;

      const ficheAfterRes = await admin.get<JsonRecord>(`/platform-admin/clients/${ownerId}`);
      expect(ficheAfterRes.status).toBe(200);
      expect(JSON.stringify(ficheAfterRes.body)).toContain(updatedNote);
    } finally {
      if (notesUpdated && ownerId) {
        const restoreNoteRes = await admin.patch(`/platform-admin/clients/${ownerId}`, {
          internalAdminNotes: originalNotes,
        });
        expect(restoreNoteRes.status, `Restore client notes failed: ${restoreNoteRes.rawText}`).toBe(200);
      }
      const deactivateRes = await admin.patch(`/platform-admin/plans/${planId}`, { isActive: false });
      expect(deactivateRes.status, `Deactivate plan failed: ${deactivateRes.rawText}`).toBe(200);
    }
  });

  test('T3.P7 (A2×A3) Refresh token rotation interleaved with authenticated tenant calls + logout revocation', async () => {
    const { client: owner1 } = await loginPlatform(
      SEED_USERS.owner1.email,
      SEED_USERS.owner1.password,
    );

    expect(
      (await owner1.get('/tenants/current', { tenantSlug: SEED_TENANTS.modaMayorista.slug })).status,
    ).toBe(200);

    const refreshRes = await owner1.post('/auth/refresh');
    expect([200, 201]).toContain(refreshRes.status);

    expect(
      (await owner1.get('/tenants/current', { tenantSlug: SEED_TENANTS.modaMayorista.slug })).status,
    ).toBe(200);

    expect((await owner1.post('/auth/logout')).status).toBe(200);
    assertRfc7807Error(
      await owner1.get('/tenants/current', { tenantSlug: SEED_TENANTS.modaMayorista.slug }),
      401,
    );
  });

  test('T3.P8 (A1×A2×A5) Same customer email registered on both stores maintains completely isolated carts & sessions', async () => {
    const sharedEmail = uniqueEmail('dual-store');
    const product = await fetchStorefrontProduct(
      SEED_PRODUCTS.hoodie.slug,
      SEED_TENANTS.modaMayorista.slug,
    );
    const variantId = String(getVariantBySku(product, SEED_PRODUCTS.hoodie.skus.blkM).id);

    const { client: modaCustomer } = await registerAndVerifyStoreCustomer({
      tenantSlug: SEED_TENANTS.modaMayorista.slug,
      email: sharedEmail,
      password: 'DualPassword123!',
    });

    const { client: electroCustomer } = await registerAndVerifyStoreCustomer({
      tenantSlug: SEED_TENANTS.electroHogar.slug,
      email: sharedEmail,
      password: 'DualPassword123!',
    });

    // Add hoodie in moda-mayorista
    const addModa = await modaCustomer.post(
      '/cart/items',
      { variantId, quantity: 3 },
      { tenantSlug: SEED_TENANTS.modaMayorista.slug },
    );
    expect([200, 201]).toContain(addModa.status);

    // electro-hogar customer cart remains empty and cannot add moda-mayorista variant
    const electroCart = await electroCustomer.get('/cart', {
      tenantSlug: SEED_TENANTS.electroHogar.slug,
    });
    expect(electroCart.status).toBe(200);
    expect(extractCartView(electroCart.body).items.length).toBe(0);

    assertRfc7807Error(
      await electroCustomer.post(
        '/cart/items',
        { variantId, quantity: 1 },
        { tenantSlug: SEED_TENANTS.electroHogar.slug },
      ),
      404,
    );
  });
});
