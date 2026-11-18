import { expect, test } from '@playwright/test';
import {
  SEED_PLANS,
  SEED_USERS,
  uniqueSlug,
} from '../../src/config/env';
import { assertRfc7807Error, extractData, type JsonRecord } from '../../src/helpers/assertions';
import {
  createBackendClient,
  getEntityId,
  loginPlatform,
  registerAndVerifyPlatformOwner,
} from '../../src/helpers/workflows';

test.describe('Tier 2 — A1: Multi-Tenant & Contract Boundaries', () => {
  test('T2.A1.1 ValidationPipe rejects unexpected non-whitelisted properties with 400 RFC 7807', async () => {
    const api = createBackendClient();
    const res = await api.post('/auth/platform/login', {
      email: SEED_USERS.owner1.email,
      password: SEED_USERS.owner1.password,
      role: 'SUPER_ADMIN',
      unexpectedPrivilegeFlag: true,
    });

    assertRfc7807Error(res, 400);
  });

  test('T2.A1.2 GET /tenants/resolve returns 404 RFC 7807 for unknown host and slug', async () => {
    const api = createBackendClient();

    const byUnknownHost = await api.get('/tenants/resolve', {
      tenantHost: 'does-not-exist-e2e.localhost:3000',
    });
    assertRfc7807Error(byUnknownHost, 404);

    const byUnknownSlug = await api.get('/tenants/resolve', {
      tenantSlug: 'does-not-exist-e2e-slug',
    });
    assertRfc7807Error(byUnknownSlug, 404);
  });

  test('T2.A1.3 Suspending an active tenant invalidates cache and returns 403 until reactivated', async () => {
    const { client: owner } = await registerAndVerifyPlatformOwner();
    const slug = uniqueSlug('suspend-cache');
    const createRes = await owner.post<JsonRecord>('/tenants', {
      name: `Suspend Test ${slug}`,
      slug,
      planCode: SEED_PLANS.EMPRENDEDOR.code,
    });
    expect(createRes.status).toBe(201);
    const tenantId = getEntityId(extractData<JsonRecord>(createRes.body));

    // Warm Redis tenant cache via /tenants/resolve & /storefront/config
    const anon = createBackendClient();
    const warmRes = await anon.get('/storefront/config', { tenantSlug: slug });
    expect(warmRes.status).toBe(200);

    // SuperAdmin suspends tenant
    const { client: admin } = await loginPlatform(
      SEED_USERS.superAdmin.email,
      SEED_USERS.superAdmin.password,
    );
    const suspRes = await admin.patch(`/platform-admin/tenants/${tenantId}/status`, {
      status: 'SUSPENDED',
    });
    expect(suspRes.status).toBe(200);

    // Cached host/slug must immediately be denied with 403
    const deniedConfig = await anon.get('/storefront/config', { tenantSlug: slug });
    assertRfc7807Error(deniedConfig, 403);

    const deniedResolve = await anon.get('/tenants/resolve', { tenantSlug: slug });
    assertRfc7807Error(deniedResolve, 403);

    // Reactivate -> allowed again
    const reactivateRes = await admin.patch(`/platform-admin/tenants/${tenantId}/status`, {
      status: 'ACTIVE',
    });
    expect(reactivateRes.status).toBe(200);

    const allowedAgain = await anon.get('/storefront/config', { tenantSlug: slug });
    expect(allowedAgain.status).toBe(200);
  });

  test('T2.A1.4 Missing tenant header on tenant-scoped routes returns 400 or 404 RFC 7807', async () => {
    const api = createBackendClient();

    const productsNoTenant = await api.get('/storefront/products');
    assertRfc7807Error(productsNoTenant, [400, 404]);

    const cartNoTenant = await api.get('/cart');
    assertRfc7807Error(cartNoTenant, [400, 404]);
  });

  test('T2.A1.5 Disallowed CORS origin is not echoed in Access-Control-Allow-Origin', async () => {
    const api = createBackendClient();
    const res = await api.get('/plans', {
      headers: {
        Origin: 'https://evil-untrusted-origin.example',
      },
    });
    const allowOrigin = res.headers.get('access-control-allow-origin');
    expect(allowOrigin).not.toBe('https://evil-untrusted-origin.example');
    expect(allowOrigin).not.toBe('*');
  });

  test('T2.A1.6 Empty tenant header on /tenants/resolve without slug query returns 400/404 RFC 7807', async () => {
    const api = createBackendClient();
    const res = await api.get('/tenants/resolve');
    assertRfc7807Error(res, [400, 404]);
  });
});
