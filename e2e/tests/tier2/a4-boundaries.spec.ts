import { expect, test } from '@playwright/test';
import {
  SEED_PLANS,
  SEED_TENANTS,
  SEED_USERS,
  uniqueId,
  uniqueSlug,
} from '../../src/config/env';
import {
  assertRfc7807Error,
  extractData,
  isRecord,
  type JsonRecord,
} from '../../src/helpers/assertions';
import {
  createBackendClient,
  getEntityId,
  loginPlatform,
  loginStoreCustomer,
  registerAndVerifyPlatformOwner,
} from '../../src/helpers/workflows';

test.describe('Tier 2 — A4: SuperAdmin CRM RBAC & Payment Boundaries', () => {
  test('T2.A4.1 Unauthenticated access to /platform-admin/* endpoints returns 401 RFC 7807', async () => {
    const anon = createBackendClient();

    assertRfc7807Error(await anon.get('/platform-admin/overview'), 401);
    assertRfc7807Error(await anon.get('/platform-admin/clients'), 401);
    assertRfc7807Error(await anon.get('/platform-admin/payments'), 401);
  });

  test('T2.A4.2 STORE_OWNER accessing /platform-admin/* endpoints is rejected with 403 RFC 7807', async () => {
    const { client: owner1 } = await loginPlatform(
      SEED_USERS.owner1.email,
      SEED_USERS.owner1.password,
    );

    assertRfc7807Error(await owner1.get('/platform-admin/overview'), 403);
    assertRfc7807Error(await owner1.get('/platform-admin/clients'), 403);
    assertRfc7807Error(
      await owner1.patch('/platform-admin/tenants/00000000-0000-0000-0000-000000000000/status', {
        status: 'SUSPENDED',
      }),
      403,
    );
  });

  test('T2.A4.3 StoreCustomer accessing /platform-admin/* endpoints is rejected with 403 RFC 7807', async () => {
    const { client: customer } = await loginStoreCustomer(
      SEED_USERS.customer1.email,
      SEED_USERS.customer1.password,
      SEED_TENANTS.modaMayorista.slug,
    );

    assertRfc7807Error(await customer.get('/platform-admin/overview'), 403);
    assertRfc7807Error(await customer.get('/platform-admin/clients'), 403);
    assertRfc7807Error(await customer.get('/platform-admin/payments'), 403);
  });

  test('T2.A4.4 Unknown ownerId, tenantId, and paymentId return 404 RFC 7807', async () => {
    const { client: admin } = await loginPlatform(
      SEED_USERS.superAdmin.email,
      SEED_USERS.superAdmin.password,
    );
    const missingId = '00000000-0000-4000-8000-000000000999';

    assertRfc7807Error(await admin.get(`/platform-admin/clients/${missingId}`), 404);
    assertRfc7807Error(
      await admin.patch(`/platform-admin/tenants/${missingId}/status`, { status: 'ACTIVE' }),
      404,
    );
    assertRfc7807Error(
      await admin.patch(`/platform-admin/payments/${missingId}/review`, {
        reviewStatus: 'APPROVED',
      }),
      404,
    );
  });

  test('T2.A4.5 Negative/zero payment amount returns 400 and double-reviewing finalized payment fails 400/409', async () => {
    const { client: owner } = await registerAndVerifyPlatformOwner();
    const slug = uniqueSlug('pay-boundary');
    const tenantRes = await owner.post<JsonRecord>('/tenants', {
      name: `Pay Boundary ${slug}`,
      slug,
      planCode: SEED_PLANS.EMPRENDEDOR.code,
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

    const invalidAmountBody: Record<string, unknown> = {
      tenantId,
      provider: 'MANUAL_TRANSFER',
      amount: -25,
      currency: 'USD',
    };
    if (subscriptionId) {
      invalidAmountBody.subscriptionId = subscriptionId;
    }
    const negRes = await admin.post('/platform-admin/payments', invalidAmountBody);
    assertRfc7807Error(negRes, 400);

    // Create valid payment, approve once, then attempt second review
    const validBody: Record<string, unknown> = {
      tenantId,
      provider: 'MANUAL_TRANSFER',
      amount: 19,
      currency: 'USD',
      externalReference: `TRF-${uniqueId('dbl').toUpperCase()}`,
    };
    if (subscriptionId) {
      validBody.subscriptionId = subscriptionId;
    }
    const payRes = await admin.post<JsonRecord>('/platform-admin/payments', validBody);
    expect(payRes.status).toBe(201);
    const paymentId = getEntityId(extractData<JsonRecord>(payRes.body));

    const firstReview = await admin.patch(`/platform-admin/payments/${paymentId}/review`, {
      reviewStatus: 'APPROVED',
    });
    expect(firstReview.status).toBe(200);

    const secondReview = await admin.patch(`/platform-admin/payments/${paymentId}/review`, {
      reviewStatus: 'REJECTED',
    });
    assertRfc7807Error(secondReview, [400, 409]);
  });
});
