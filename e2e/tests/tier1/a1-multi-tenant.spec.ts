import { expect, test } from '@playwright/test';
import { ENDPOINTS, ENV, SEED_TENANTS } from '../../src/config/env';
import {
  assertOpenApi3Document,
  assertRfc7807Error,
  extractData,
  type JsonRecord,
} from '../../src/helpers/assertions';
import { HttpClient } from '../../src/helpers/http-client';
import { createBackendClient } from '../../src/helpers/workflows';

test.describe('Tier 1 — A1: Multi-Tenant Host Resolution, Health & OpenAPI', () => {
  test('T1.A1.1 GET /health reports database and Redis connectivity', async () => {
    const api = createBackendClient();
    const res = await api.get<JsonRecord>('/health');

    expect(res.status, `Healthcheck failed: ${res.rawText}`).toBe(200);
    const data = extractData<JsonRecord>(res.body);
    expect(String(data.status ?? '').toLowerCase()).toMatch(/ok|up|healthy/);
    expect(String(data.db ?? data.database ?? '').toLowerCase()).toMatch(/ok|up|connected|true/);
    expect(String(data.redis ?? '').toLowerCase()).toMatch(/ok|up|connected|true/);
  });

  test('T1.A1.2 GET /api/docs-json exposes valid OpenAPI 3.x spec with Phase 1 routes', async () => {
    const rootClient = new HttpClient({ baseUrl: ENV.backendUrl });
    const res = await rootClient.get<JsonRecord>('/api/docs-json');

    expect(res.status).toBe(200);
    assertOpenApi3Document(res.body);

    const paths = Object.keys(res.body.paths as JsonRecord);
    const joined = paths.join('\n');
    expect(joined).toContain('health');
    expect(joined).toContain('auth/capabilities');
    expect(joined).toContain('plans');
    expect(joined).toContain('tenants/resolve');
    expect(joined).toContain('platform-admin');
    expect(joined).toContain('storefront');
    expect(joined).toContain('cart');
  });

  test('T1.A1.3 GET /tenants/resolve resolves moda-mayorista via x-tenant-host', async () => {
    const api = createBackendClient();
    const res = await api.get<JsonRecord>('/tenants/resolve', {
      tenantHost: SEED_TENANTS.modaMayorista.host,
    });

    expect(res.status, `Resolve failed: ${res.rawText}`).toBe(200);
    const tenant = extractData<JsonRecord>(res.body);
    expect(tenant.slug).toBe(SEED_TENANTS.modaMayorista.slug);
    expect(tenant.name).toBe(SEED_TENANTS.modaMayorista.name);
    expect(tenant.status).toBe(SEED_TENANTS.modaMayorista.status);

    const theme = tenant.theme as JsonRecord | undefined;
    expect(theme).toBeDefined();
    expect(theme?.primaryColor).toBe(SEED_TENANTS.modaMayorista.theme.primaryColor);
    expect(theme?.accentColor).toBe(SEED_TENANTS.modaMayorista.theme.accentColor);
  });

  test('T1.A1.4 GET /tenants/resolve resolves electro-hogar via x-tenant-host', async () => {
    const api = createBackendClient();
    const res = await api.get<JsonRecord>('/tenants/resolve', {
      tenantHost: SEED_TENANTS.electroHogar.host,
    });

    expect(res.status, `Resolve failed: ${res.rawText}`).toBe(200);
    const tenant = extractData<JsonRecord>(res.body);
    expect(tenant.slug).toBe(SEED_TENANTS.electroHogar.slug);
    expect(tenant.name).toBe(SEED_TENANTS.electroHogar.name);
    expect(tenant.status).toBe(SEED_TENANTS.electroHogar.status);
  });

  test('T1.A1.5 GET /tenants/resolve resolves tenant via x-tenant-slug header and ?slug query', async () => {
    const api = createBackendClient();

    const byHeader = await api.get<JsonRecord>('/tenants/resolve', {
      tenantSlug: SEED_TENANTS.modaMayorista.slug,
    });
    expect(byHeader.status).toBe(200);
    expect(extractData<JsonRecord>(byHeader.body).slug).toBe(SEED_TENANTS.modaMayorista.slug);

    const byQuery = await api.get<JsonRecord>(
      `/tenants/resolve?slug=${encodeURIComponent(SEED_TENANTS.electroHogar.slug)}`,
    );
    expect(byQuery.status).toBe(200);
    expect(extractData<JsonRecord>(byQuery.body).slug).toBe(SEED_TENANTS.electroHogar.slug);
  });

  test('T1.A1.6 CORS allows *.localhost subdomain origin and Helmet security headers are set', async () => {
    const origin = `http://${SEED_TENANTS.modaMayorista.host}`;
    const api = new HttpClient({ baseUrl: ENDPOINTS.apiBaseUrl });

    const preflight = await api.options('/storefront/config', {
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'x-tenant-host,content-type',
      },
    });
    expect([200, 204]).toContain(preflight.status);
    expect(preflight.headers.get('access-control-allow-origin')).toBe(origin);
    expect(preflight.headers.get('access-control-allow-credentials')).toBe('true');

    const getRes = await api.get('/health', {
      headers: { Origin: origin },
    });
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get('access-control-allow-origin')).toBe(origin);
    expect(getRes.headers.get('x-content-type-options')).toBe('nosniff');

    // Sanity check RFC 7807 format on unknown route
    const notFound = await api.get('/nonexistent-e2e-route-check');
    assertRfc7807Error(notFound, 404);
  });
});
