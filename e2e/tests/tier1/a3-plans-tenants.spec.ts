import { expect, test } from '@playwright/test';
import {
  SEED_PLANS,
  SEED_TENANTS,
  SEED_USERS,
  uniqueId,
  uniqueSlug,
} from '../../src/config/env';
import {
  extractArray,
  extractData,
  isRecord,
  type JsonRecord,
} from '../../src/helpers/assertions';
import {
  createBackendClient,
  getEntityId,
  loginPlatform,
  registerAndVerifyPlatformOwner,
} from '../../src/helpers/workflows';

test.describe('Tier 1 — A3: SaaS Plans, Store Onboarding & StoreTheme', () => {
  test('T1.A3.1 GET /plans returns seeded SaaS plans with pricing and quotas', async () => {
    const api = createBackendClient();
    const res = await api.get<unknown>('/plans');
    expect(res.status).toBe(200);

    const plans = extractArray<JsonRecord>(res.body);
    const codes = plans.map((p) => String(p.code));
    expect(codes).toContain(SEED_PLANS.EMPRENDEDOR.code);
    expect(codes).toContain(SEED_PLANS.CRECIMIENTO_PRO.code);
    expect(codes).toContain(SEED_PLANS.MAYORISTA_ENTERPRISE.code);

    const pro = plans.find((p) => p.code === SEED_PLANS.CRECIMIENTO_PRO.code);
    expect(Number(pro?.priceMonthly)).toBe(SEED_PLANS.CRECIMIENTO_PRO.priceMonthly);
    expect(Number(pro?.maxProducts)).toBe(SEED_PLANS.CRECIMIENTO_PRO.maxProducts);
  });

  test('T1.A3.2 SuperAdmin creates and updates a SaaS plan via /platform-admin/plans', async () => {
    const { client: admin } = await loginPlatform(
      SEED_USERS.superAdmin.email,
      SEED_USERS.superAdmin.password,
    );
    const planCode = `E2E_PLAN_${uniqueId('p').toUpperCase().replace(/[^A-Z0-9_]/g, '_')}`;

    const createRes = await admin.post<JsonRecord>('/platform-admin/plans', {
      code: planCode,
      name: 'Plan Temporal E2E',
      description: 'Plan de prueba automatizada',
      priceMonthly: 79,
      priceYearly: 790,
      currency: 'USD',
      maxProducts: 2500,
      maxStaff: 5,
      allowCustomDomain: true,
      allowCsvImport: true,
      allowAbandonedCart: true,
      allowWholesale: true,
      allowCoupons: true,
      isActive: true,
      sortOrder: 99,
    });
    expect(createRes.status, `Create plan failed: ${createRes.rawText}`).toBe(201);
    const createdPlan = extractData<JsonRecord>(createRes.body);
    const planId = getEntityId(createdPlan);

    try {
      expect(createdPlan.code).toBe(planCode);
      const updateRes = await admin.patch<JsonRecord>(`/platform-admin/plans/${planId}`, {
        priceMonthly: 85,
        maxProducts: 3000,
      });
      expect(updateRes.status, `Update plan failed: ${updateRes.rawText}`).toBe(200);
      const updated = extractData<JsonRecord>(updateRes.body);
      expect(Number(updated.priceMonthly)).toBe(85);
      expect(Number(updated.maxProducts)).toBe(3000);
    } finally {
      // Deactivate temporary plan so public landing remains clean
      const deactivateRes = await admin.patch(`/platform-admin/plans/${planId}`, { isActive: false });
      expect(deactivateRes.status, `Deactivate plan failed: ${deactivateRes.rawText}`).toBe(200);
    }
  });

  test('T1.A3.3 Authenticated Store Owner onboards a new tenant via POST /tenants', async () => {
    const { client: owner } = await registerAndVerifyPlatformOwner();
    const slug = uniqueSlug('bodega');
    const storeName = `Tienda ${slug}`;

    const createRes = await owner.post<JsonRecord>('/tenants', {
      name: storeName,
      slug,
      currency: 'USD',
      whatsappSalesNumber: '5491155551234',
      planCode: SEED_PLANS.EMPRENDEDOR.code,
    });
    expect(createRes.status, `Tenant onboarding failed: ${createRes.rawText}`).toBe(201);
    const created = extractData<JsonRecord>(createRes.body);
    expect(created.slug).toBe(slug);
    expect(created.name).toBe(storeName);

    const resolveRes = await createBackendClient().get<JsonRecord>('/tenants/resolve', {
      tenantSlug: slug,
    });
    expect(resolveRes.status).toBe(200);
    expect(extractData<JsonRecord>(resolveRes.body).slug).toBe(slug);
  });

  test('T1.A3.4 Store Owner reads current tenant context via GET /tenants/current', async () => {
    const { client: owner1 } = await loginPlatform(
      SEED_USERS.owner1.email,
      SEED_USERS.owner1.password,
    );

    const res = await owner1.get<JsonRecord>('/tenants/current', {
      tenantSlug: SEED_TENANTS.modaMayorista.slug,
    });
    expect(res.status, `GET /tenants/current failed: ${res.rawText}`).toBe(200);
    const tenant = extractData<JsonRecord>(res.body);
    expect(tenant.slug).toBe(SEED_TENANTS.modaMayorista.slug);
    expect(tenant.name).toBe(SEED_TENANTS.modaMayorista.name);
  });

  test('T1.A3.5 Store Owner updates StoreTheme and /storefront/config immediately reflects it (then restores)', async () => {
    const { client: owner1 } = await loginPlatform(
      SEED_USERS.owner1.email,
      SEED_USERS.owner1.password,
    );
    const currentRes = await owner1.get<JsonRecord>('/tenants/current', {
      tenantSlug: SEED_TENANTS.modaMayorista.slug,
    });
    expect(currentRes.status, `GET /tenants/current failed: ${currentRes.rawText}`).toBe(200);
    const currentTenant = extractData<JsonRecord>(currentRes.body);
    const liveTheme = isRecord(currentTenant.theme) ? currentTenant.theme : undefined;
    const fallbackTheme = SEED_TENANTS.modaMayorista.theme;
    const originalTheme = {
      primaryColor: String(liveTheme?.primaryColor ?? fallbackTheme.primaryColor),
      accentColor: String(liveTheme?.accentColor ?? fallbackTheme.accentColor),
      darkModeDefault: Boolean(liveTheme?.darkModeDefault ?? fallbackTheme.darkModeDefault),
      heroTitle: String(liveTheme?.heroTitle ?? fallbackTheme.heroTitle),
      heroSubtitle: String(liveTheme?.heroSubtitle ?? fallbackTheme.heroSubtitle),
      announcementText: String(liveTheme?.announcementText ?? fallbackTheme.announcementText),
    };
    const tempAccent = '#10B981';
    const tempAnnouncement = 'Promo E2E temporal';

    try {
      const patchRes = await owner1.patch<JsonRecord>(
        '/tenants/current/theme',
        {
          accentColor: tempAccent,
          announcementText: tempAnnouncement,
        },
        { tenantSlug: SEED_TENANTS.modaMayorista.slug },
      );
      expect(patchRes.status, `Theme update failed: ${patchRes.rawText}`).toBe(200);

      const configRes = await createBackendClient().get<JsonRecord>('/storefront/config', {
        tenantHost: SEED_TENANTS.modaMayorista.host,
      });
      expect(configRes.status).toBe(200);
      const config = extractData<JsonRecord>(configRes.body);
      const theme = (config.theme ?? (config.tenant as JsonRecord | undefined)?.theme) as JsonRecord;
      expect(theme.accentColor).toBe(tempAccent);
      expect(theme.announcementText).toBe(tempAnnouncement);
    } finally {
      const restoreRes = await owner1.patch(
        '/tenants/current/theme',
        originalTheme,
        { tenantSlug: SEED_TENANTS.modaMayorista.slug },
      );
      expect(restoreRes.status, `Theme restore failed: ${restoreRes.rawText}`).toBe(200);
    }
  });
});
