import { expect, test } from '@playwright/test';
import {
  SEED_PLANS,
  SEED_TENANTS,
  SEED_USERS,
  uniqueId,
} from '../../src/config/env';
import { assertRfc7807Error, extractData, type JsonRecord } from '../../src/helpers/assertions';
import {
  createBackendClient,
  loginPlatform,
  loginStoreCustomer,
  registerAndVerifyPlatformOwner,
} from '../../src/helpers/workflows';

test.describe('Tier 2 — A3: Plans & Tenant Boundaries', () => {
  test('T2.A3.1 POST /tenants with duplicate slug (moda-mayorista) returns 409 Conflict', async () => {
    const { client: owner } = await registerAndVerifyPlatformOwner();
    const dupRes = await owner.post('/tenants', {
      name: 'Duplicate Store',
      slug: SEED_TENANTS.modaMayorista.slug,
      planCode: SEED_PLANS.EMPRENDEDOR.code,
    });
    assertRfc7807Error(dupRes, 409);
  });

  test('T2.A3.2 POST /tenants rejects reserved or malformed slugs with 400 RFC 7807', async () => {
    const { client: owner } = await registerAndVerifyPlatformOwner();

    const reservedRes = await owner.post('/tenants', {
      name: 'Reserved Admin Store',
      slug: 'admin',
      planCode: SEED_PLANS.EMPRENDEDOR.code,
    });
    assertRfc7807Error(reservedRes, [400, 409]);

    const invalidFormatRes = await owner.post('/tenants', {
      name: 'Invalid Slug Store',
      slug: 'Invalid Slug With Spaces!',
      planCode: SEED_PLANS.EMPRENDEDOR.code,
    });
    assertRfc7807Error(invalidFormatRes, 400);
  });

  test('T2.A3.3 Non-SuperAdmin users cannot create or update SaaS plans (403 Forbidden)', async () => {
    const { client: owner1 } = await loginPlatform(
      SEED_USERS.owner1.email,
      SEED_USERS.owner1.password,
    );

    const ownerCreate = await owner1.post('/platform-admin/plans', {
      code: `FORBIDDEN_${uniqueId('p').toUpperCase()}`,
      name: 'Forbidden Plan',
      priceMonthly: 10,
      priceYearly: 100,
      maxProducts: 10,
      maxStaff: 1,
    });
    assertRfc7807Error(ownerCreate, 403);

    const { client: customer } = await loginStoreCustomer(
      SEED_USERS.customer1.email,
      SEED_USERS.customer1.password,
      SEED_TENANTS.modaMayorista.slug,
    );
    const custCreate = await customer.post('/platform-admin/plans', {
      code: `FORBIDDEN_C_${uniqueId('p').toUpperCase()}`,
      name: 'Forbidden Customer Plan',
      priceMonthly: 10,
      priceYearly: 100,
      maxProducts: 10,
      maxStaff: 1,
    });
    assertRfc7807Error(custCreate, 403);
  });

  test('T2.A3.4 Cross-tenant theme update by Owner 2 targeting moda-mayorista fails 403 without mutating theme', async () => {
    const { client: owner2 } = await loginPlatform(
      SEED_USERS.owner2.email,
      SEED_USERS.owner2.password,
    );

    const tamperRes = await owner2.patch(
      '/tenants/current/theme',
      {
        primaryColor: '#FF0000',
        heroTitle: 'Hacked Title',
      },
      { tenantSlug: SEED_TENANTS.modaMayorista.slug },
    );
    assertRfc7807Error(tamperRes, 403);

    const configRes = await createBackendClient().get<JsonRecord>('/storefront/config', {
      tenantSlug: SEED_TENANTS.modaMayorista.slug,
    });
    expect(configRes.status).toBe(200);
    const config = extractData<JsonRecord>(configRes.body);
    expect(JSON.stringify(config)).not.toContain('Hacked Title');
    expect(JSON.stringify(config)).toContain(SEED_TENANTS.modaMayorista.theme.primaryColor);
  });

  test('T2.A3.5 Invalid hex color on theme update and negative quota on plan creation return 400', async () => {
    const { client: owner1 } = await loginPlatform(
      SEED_USERS.owner1.email,
      SEED_USERS.owner1.password,
    );
    const badTheme = await owner1.patch(
      '/tenants/current/theme',
      { primaryColor: 'not-a-hex-color' },
      { tenantSlug: SEED_TENANTS.modaMayorista.slug },
    );
    assertRfc7807Error(badTheme, 400);

    const { client: admin } = await loginPlatform(
      SEED_USERS.superAdmin.email,
      SEED_USERS.superAdmin.password,
    );
    const badPlan = await admin.post('/platform-admin/plans', {
      code: `BAD_PLAN_${uniqueId('p').toUpperCase()}`,
      name: 'Negative Quota Plan',
      priceMonthly: -10,
      priceYearly: 100,
      maxProducts: -5,
      maxStaff: 0,
    });
    assertRfc7807Error(badPlan, 400);
  });
});
