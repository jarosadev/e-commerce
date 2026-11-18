import { expect, test } from '@playwright/test';
import {
  SEED_COUPONS,
  SEED_PRODUCTS,
  SEED_TENANTS,
  SEED_USERS,
} from '../../src/config/env';
import {
  extractArray,
  extractData,
  type JsonRecord,
} from '../../src/helpers/assertions';
import {
  createBackendClient,
  extractCartItemUnitPrice,
  extractCartView,
  fetchStorefrontProduct,
  getVariantBySku,
  loginStoreCustomer,
} from '../../src/helpers/workflows';

test.describe('Tier 1 — A5: Storefront Catalog, B2B Tiers, Coupons & Persistent Cart', () => {
  test('T1.A5.1 GET /storefront/config returns Urban Threads theme, payment methods & shipping zones', async () => {
    const api = createBackendClient();
    const res = await api.get<JsonRecord>('/storefront/config', {
      tenantHost: SEED_TENANTS.modaMayorista.host,
    });
    expect(res.status, `Config failed: ${res.rawText}`).toBe(200);

    const config = extractData<JsonRecord>(res.body);
    const serialized = JSON.stringify(config);
    expect(serialized).toContain(SEED_TENANTS.modaMayorista.name);
    expect(serialized).toContain(SEED_TENANTS.modaMayorista.theme.primaryColor);
    expect(serialized).toContain('Transferencia Bancaria');
    expect(serialized).toContain('Envío Express');
  });

  test('T1.A5.2 GET /storefront/categories & /products return isolated tenant catalogs', async () => {
    const api = createBackendClient();

    const catsRes = await api.get<unknown>('/storefront/categories', {
      tenantSlug: SEED_TENANTS.modaMayorista.slug,
    });
    expect(catsRes.status).toBe(200);
    const categories = extractArray<JsonRecord>(catsRes.body);
    expect(categories.length).toBeGreaterThanOrEqual(3);

    const prodsRes = await api.get<unknown>('/storefront/products', {
      tenantSlug: SEED_TENANTS.modaMayorista.slug,
    });
    expect(prodsRes.status).toBe(200);
    const products = extractArray<JsonRecord>(prodsRes.body);
    expect(products.length).toBeGreaterThanOrEqual(3);
    const slugs = products.map((p) => String(p.slug));
    expect(slugs).toContain(SEED_PRODUCTS.hoodie.slug);
    expect(slugs).toContain(SEED_PRODUCTS.sneaker.slug);
    expect(slugs).toContain(SEED_PRODUCTS.backpack.slug);

    // electro-hogar has 0 seeded products and must not leak moda-mayorista catalog
    const electroProdsRes = await api.get<unknown>('/storefront/products', {
      tenantSlug: SEED_TENANTS.electroHogar.slug,
    });
    expect(electroProdsRes.status).toBe(200);
    const electroProducts = extractArray<JsonRecord>(electroProdsRes.body);
    expect(electroProducts).toEqual([]);
  });

  test('T1.A5.3 GET /storefront/products/:slug returns variants and B2B wholesaleTiers', async () => {
    const product = await fetchStorefrontProduct(
      SEED_PRODUCTS.hoodie.slug,
      SEED_TENANTS.modaMayorista.slug,
    );
    expect(product.slug).toBe(SEED_PRODUCTS.hoodie.slug);
    expect(product.name).toBe(SEED_PRODUCTS.hoodie.name);

    const variants = product.variants as JsonRecord[];
    expect(variants.length).toBeGreaterThanOrEqual(3);
    expect(variants.map((v) => v.sku)).toContain(SEED_PRODUCTS.hoodie.skus.blkM);

    const tiers = product.wholesaleTiers as JsonRecord[];
    expect(Array.isArray(tiers)).toBe(true);
    expect(tiers.length).toBe(2);
    expect(Number(tiers[0]?.minQuantity)).toBe(6);
    expect(Number(tiers[0]?.unitPrice)).toBe(33);
    expect(Number(tiers[1]?.minQuantity)).toBe(12);
    expect(Number(tiers[1]?.unitPrice)).toBe(26.5);
  });

  test('T1.A5.4 POST /storefront/coupons/validate validates BIENVENIDA10 on subtotal >= $50', async () => {
    const api = createBackendClient();
    const res = await api.post<JsonRecord>(
      '/storefront/coupons/validate',
      { code: SEED_COUPONS.bienvenida10.code, subtotal: 100 },
      { tenantSlug: SEED_TENANTS.modaMayorista.slug },
    );
    expect(res.status, `Coupon validate failed: ${res.rawText}`).toBe(200);
    const data = extractData<JsonRecord>(res.body);
    expect(data.valid).toBe(true);
    expect(data.code).toBe(SEED_COUPONS.bienvenida10.code);
    expect(Number(data.discountAmount)).toBe(10);
  });

  test('T1.A5.5 Guest cart sets HttpOnly guest_cart_token cookie and recalculates B2B tiers ($42 -> $33 -> $26.50)', async () => {
    const product = await fetchStorefrontProduct(
      SEED_PRODUCTS.hoodie.slug,
      SEED_TENANTS.modaMayorista.slug,
    );
    const variant = getVariantBySku(product, SEED_PRODUCTS.hoodie.skus.blkM);
    const variantId = String(variant.id);

    const api = createBackendClient();
    const initCart = await api.get<JsonRecord>('/cart', {
      tenantSlug: SEED_TENANTS.modaMayorista.slug,
    });
    expect(initCart.status).toBe(200);

    // Add 2 units -> retail price $42.00
    const add2 = await api.post<JsonRecord>(
      '/cart/items',
      { variantId, quantity: 2 },
      { tenantSlug: SEED_TENANTS.modaMayorista.slug },
    );
    expect([200, 201], `Add cart item failed: ${add2.rawText}`).toContain(add2.status);
    const guestCookie = api.jar.get('guest_cart_token');
    expect(guestCookie, 'guest_cart_token cookie must be set').toBeDefined();
    expect(guestCookie?.httpOnly).toBe(true);

    const cart2 = extractCartView(add2.body);
    expect(cart2.items.length).toBe(1);
    expect(extractCartItemUnitPrice(cart2.items[0] as JsonRecord)).toBe(42);
    expect(cart2.subtotal).toBe(84);

    const itemId = String(cart2.items[0]?.id);

    // Update to 6 units -> tier 1 ($33.00)
    const patch6 = await api.patch<JsonRecord>(
      `/cart/items/${itemId}`,
      { quantity: 6 },
      { tenantSlug: SEED_TENANTS.modaMayorista.slug },
    );
    expect(patch6.status).toBe(200);
    const cart6 = extractCartView(patch6.body);
    expect(extractCartItemUnitPrice(cart6.items[0] as JsonRecord)).toBe(33);
    expect(cart6.subtotal).toBe(198);

    // Update to 12 units -> tier 2 ($26.50)
    const patch12 = await api.patch<JsonRecord>(
      `/cart/items/${itemId}`,
      { quantity: 12 },
      { tenantSlug: SEED_TENANTS.modaMayorista.slug },
    );
    expect(patch12.status).toBe(200);
    const cart12 = extractCartView(patch12.body);
    expect(extractCartItemUnitPrice(cart12.items[0] as JsonRecord)).toBe(26.5);
    expect(cart12.subtotal).toBe(318);

    // Remove item -> cart empty
    const delRes = await api.delete<JsonRecord>(`/cart/items/${itemId}`, {
      tenantSlug: SEED_TENANTS.modaMayorista.slug,
    });
    expect(delRes.status).toBe(200);
    expect(extractCartView(delRes.body).items.length).toBe(0);
  });

  test('T1.A5.6 Guest cart merges into authenticated StoreCustomer cart via login / POST /cart/merge', async () => {
    const product = await fetchStorefrontProduct(
      SEED_PRODUCTS.backpack.slug,
      SEED_TENANTS.modaMayorista.slug,
    );
    const variantId = String(getVariantBySku(product, SEED_PRODUCTS.backpack.skus.grf).id);

    // Ensure seeded customer cart starts clean
    const { client: cleanCustomer } = await loginStoreCustomer(
      SEED_USERS.customer1.email,
      SEED_USERS.customer1.password,
      SEED_TENANTS.modaMayorista.slug,
    );
    await cleanCustomer.delete('/cart', { tenantSlug: SEED_TENANTS.modaMayorista.slug });

    // Anonymous guest adds 2 backpacks
    const guestClient = createBackendClient();
    const addRes = await guestClient.post<JsonRecord>(
      '/cart/items',
      { variantId, quantity: 2 },
      { tenantSlug: SEED_TENANTS.modaMayorista.slug },
    );
    expect([200, 201]).toContain(addRes.status);
    expect(guestClient.jar.has('guest_cart_token')).toBe(true);

    // Login using same cookie jar so guest_cart_token is carried, then call /cart/merge explicitly if items not already merged
    try {
      await loginStoreCustomer(
        SEED_USERS.customer1.email,
        SEED_USERS.customer1.password,
        SEED_TENANTS.modaMayorista.slug,
        guestClient,
      );

      let cartRes = await guestClient.get<JsonRecord>('/cart', {
        tenantSlug: SEED_TENANTS.modaMayorista.slug,
      });
      let cart = extractCartView(cartRes.body);
      if (cart.items.length === 0) {
        const mergeRes = await guestClient.post<JsonRecord>(
          '/cart/merge',
          {},
          { tenantSlug: SEED_TENANTS.modaMayorista.slug },
        );
        expect([200, 201]).toContain(mergeRes.status);
        cartRes = mergeRes;
        cart = extractCartView(cartRes.body);
      }

      expect(cart.items.length).toBe(1);
      expect(Number(cart.items[0]?.quantity)).toBe(2);
      expect(cart.subtotal).toBe(110);
    } finally {
      if (guestClient.jar.has('access_token')) {
        await guestClient.delete('/cart', { tenantSlug: SEED_TENANTS.modaMayorista.slug });
      } else {
        await cleanCustomer.delete('/cart', { tenantSlug: SEED_TENANTS.modaMayorista.slug });
      }
    }
  });
});
