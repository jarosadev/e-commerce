import { expect, test } from '@playwright/test';
import {
  SEED_COUPONS,
  SEED_PRODUCTS,
  SEED_TENANTS,
  uniqueEmail,
} from '../../src/config/env';
import { assertRfc7807Error, type JsonRecord } from '../../src/helpers/assertions';
import {
  createBackendClient,
  extractCartItemUnitPrice,
  extractCartView,
  fetchStorefrontProduct,
  getVariantBySku,
  registerAndVerifyStoreCustomer,
} from '../../src/helpers/workflows';

test.describe('Tier 2 — A5: Storefront & Cart Boundary & Isolation Cases', () => {
  test('T2.A5.1 Cart rejects quantity 0 and negative quantity with 400 RFC 7807', async () => {
    const product = await fetchStorefrontProduct(
      SEED_PRODUCTS.hoodie.slug,
      SEED_TENANTS.modaMayorista.slug,
    );
    const variantId = String(getVariantBySku(product, SEED_PRODUCTS.hoodie.skus.blkM).id);
    const api = createBackendClient();

    const zeroRes = await api.post(
      '/cart/items',
      { variantId, quantity: 0 },
      { tenantSlug: SEED_TENANTS.modaMayorista.slug },
    );
    assertRfc7807Error(zeroRes, 400);

    const negRes = await api.post(
      '/cart/items',
      { variantId, quantity: -3 },
      { tenantSlug: SEED_TENANTS.modaMayorista.slug },
    );
    assertRfc7807Error(negRes, 400);
  });

  test('T2.A5.2 Cart rejects quantity exceeding available stockOnHand with 400 RFC 7807', async () => {
    const product = await fetchStorefrontProduct(
      SEED_PRODUCTS.hoodie.slug,
      SEED_TENANTS.modaMayorista.slug,
    );
    const variant = getVariantBySku(product, SEED_PRODUCTS.hoodie.skus.blkM);
    const variantId = String(variant.id);
    const overStockQty = Number(variant.stockOnHand ?? 85) + 5000;

    const api = createBackendClient();
    const res = await api.post(
      '/cart/items',
      { variantId, quantity: overStockQty },
      { tenantSlug: SEED_TENANTS.modaMayorista.slug },
    );
    assertRfc7807Error(res, 400);
  });

  test('T2.A5.3 Coupon BIENVENIDA10 is rejected below minPurchaseAmount ($42 < $50)', async () => {
    const api = createBackendClient();
    const res = await api.post(
      '/storefront/coupons/validate',
      { code: SEED_COUPONS.bienvenida10.code, subtotal: 42 },
      { tenantSlug: SEED_TENANTS.modaMayorista.slug },
    );
    assertRfc7807Error(res, [400, 422]);
  });

  test('T2.A5.4 Cross-tenant product slug & variantId isolation under electro-hogar returns 404', async () => {
    const modaProduct = await fetchStorefrontProduct(
      SEED_PRODUCTS.hoodie.slug,
      SEED_TENANTS.modaMayorista.slug,
    );
    const modaVariantId = String(getVariantBySku(modaProduct, SEED_PRODUCTS.hoodie.skus.blkM).id);
    const api = createBackendClient();

    const slugLeak = await api.get(`/storefront/products/${SEED_PRODUCTS.hoodie.slug}`, {
      tenantSlug: SEED_TENANTS.electroHogar.slug,
    });
    assertRfc7807Error(slugLeak, 404);

    const variantLeak = await api.post(
      '/cart/items',
      { variantId: modaVariantId, quantity: 1 },
      { tenantSlug: SEED_TENANTS.electroHogar.slug },
    );
    assertRfc7807Error(variantLeak, 404);
  });

  test('T2.A5.5 B2B wholesale tier exact boundary transitions (qty 5 -> 6 -> 11 -> 12 -> 3)', async () => {
    const product = await fetchStorefrontProduct(
      SEED_PRODUCTS.hoodie.slug,
      SEED_TENANTS.modaMayorista.slug,
    );
    const variantId = String(getVariantBySku(product, SEED_PRODUCTS.hoodie.skus.blkL).id);
    const api = createBackendClient();

    try {
      // qty = 5 -> just below tier 1 (min 6) -> $42.00
      const add5 = await api.post<JsonRecord>(
        '/cart/items',
        { variantId, quantity: 5 },
        { tenantSlug: SEED_TENANTS.modaMayorista.slug },
      );
      expect([200, 201]).toContain(add5.status);
      let cart = extractCartView(add5.body);
      expect(extractCartItemUnitPrice(cart.items[0] as JsonRecord)).toBe(42);
      expect(cart.subtotal).toBe(210);
      const itemId = String(cart.items[0]?.id);

      // qty = 6 -> lower bound of tier 1 -> $33.00
      const p6 = await api.patch<JsonRecord>(
        `/cart/items/${itemId}`,
        { quantity: 6 },
        { tenantSlug: SEED_TENANTS.modaMayorista.slug },
      );
      expect(p6.status).toBe(200);
      cart = extractCartView(p6.body);
      expect(extractCartItemUnitPrice(cart.items[0] as JsonRecord)).toBe(33);
      expect(cart.subtotal).toBe(198);

      // qty = 11 -> upper bound of tier 1 -> $33.00
      const p11 = await api.patch<JsonRecord>(
        `/cart/items/${itemId}`,
        { quantity: 11 },
        { tenantSlug: SEED_TENANTS.modaMayorista.slug },
      );
      expect(p11.status).toBe(200);
      cart = extractCartView(p11.body);
      expect(extractCartItemUnitPrice(cart.items[0] as JsonRecord)).toBe(33);
      expect(cart.subtotal).toBe(363);

      // qty = 12 -> lower bound of tier 2 -> $26.50
      const p12 = await api.patch<JsonRecord>(
        `/cart/items/${itemId}`,
        { quantity: 12 },
        { tenantSlug: SEED_TENANTS.modaMayorista.slug },
      );
      expect(p12.status).toBe(200);
      cart = extractCartView(p12.body);
      expect(extractCartItemUnitPrice(cart.items[0] as JsonRecord)).toBe(26.5);
      expect(cart.subtotal).toBe(318);

      // qty = 3 -> reverts back to retail $42.00
      const p3 = await api.patch<JsonRecord>(
        `/cart/items/${itemId}`,
        { quantity: 3 },
        { tenantSlug: SEED_TENANTS.modaMayorista.slug },
      );
      expect(p3.status).toBe(200);
      cart = extractCartView(p3.body);
      expect(extractCartItemUnitPrice(cart.items[0] as JsonRecord)).toBe(42);
      expect(cart.subtotal).toBe(126);
    } finally {
      await api.delete('/cart', { tenantSlug: SEED_TENANTS.modaMayorista.slug });
    }
  });

  test('T2.A5.6 Cross-tenant coupon & guest cart isolation between moda-mayorista and electro-hogar', async () => {
    // Coupon BIENVENIDA10 belongs to moda-mayorista -> rejected on electro-hogar
    const couponOnElectro = await createBackendClient().post(
      '/storefront/coupons/validate',
      { code: SEED_COUPONS.bienvenida10.code, subtotal: 100 },
      { tenantSlug: SEED_TENANTS.electroHogar.slug },
    );
    assertRfc7807Error(couponOnElectro, [400, 404]);

    // Guest cart created on moda-mayorista must NOT merge into electro-hogar customer
    const product = await fetchStorefrontProduct(
      SEED_PRODUCTS.hoodie.slug,
      SEED_TENANTS.modaMayorista.slug,
    );
    const variantId = String(getVariantBySku(product, SEED_PRODUCTS.hoodie.skus.blkM).id);

    const guestClient = createBackendClient();
    const addModa = await guestClient.post(
      '/cart/items',
      { variantId, quantity: 1 },
      { tenantSlug: SEED_TENANTS.modaMayorista.slug },
    );
    expect([200, 201]).toContain(addModa.status);
    const modaGuestToken = guestClient.jar.getValue('guest_cart_token');
    expect(modaGuestToken).toBeTruthy();

    const { client: electroBuyer } = await registerAndVerifyStoreCustomer({
      tenantSlug: SEED_TENANTS.electroHogar.slug,
      email: uniqueEmail('electro-iso'),
    });
    if (modaGuestToken) {
      electroBuyer.jar.set('guest_cart_token', modaGuestToken);
    }

    const crossMerge = await electroBuyer.post(
      '/cart/merge',
      {},
      { tenantSlug: SEED_TENANTS.electroHogar.slug },
    );
    if (crossMerge.status >= 400) {
      assertRfc7807Error(crossMerge, [403, 404]);
    }
    const electroCart = await electroBuyer.get<JsonRecord>('/cart', {
      tenantSlug: SEED_TENANTS.electroHogar.slug,
    });
    expect(electroCart.status).toBe(200);
    expect(extractCartView(electroCart.body).items.length).toBe(0);
  });
});
