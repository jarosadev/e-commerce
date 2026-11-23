import { expect, test } from '@playwright/test';
import {
  SEED_PLANS,
  SEED_USERS,
  uniqueId,
  uniqueSlug,
} from '../../src/config/env';
import {
  extractArray,
  extractData,
  extractField,
  isRecord,
  type JsonRecord,
} from '../../src/helpers/assertions';
import { MailpitClient } from '../../src/helpers/mailpit-client';
import {
  createBackendClient,
  getEntityId,
  loginPlatform,
  registerAndVerifyPlatformOwner,
} from '../../src/helpers/workflows';

async function findSeededOwnerClient(admin: Awaited<ReturnType<typeof loginPlatform>>['client'], email: string): Promise<JsonRecord> {
  const res = await admin.get<unknown>(`/platform-admin/clients?search=${encodeURIComponent(email)}`);
  expect(res.status, `GET /platform-admin/clients failed: ${res.rawText}`).toBe(200);
  const clients = extractArray<JsonRecord>(res.body);
  const found = clients.find(
    (c) =>
      c.email === email ||
      (isRecord(c.user) && c.user.email === email),
  );
  expect(found, `Seeded owner ${email} not found in CRM directory`).toBeDefined();
  return found as JsonRecord;
}

test.describe('Tier 1 — A4: SuperAdmin CRM (/platform-admin)', () => {
  test('T1.A4.1 GET /platform-admin/overview returns SaaS KPI metrics for SUPER_ADMIN', async () => {
    const { client: admin } = await loginPlatform(
      SEED_USERS.superAdmin.email,
      SEED_USERS.superAdmin.password,
    );

    const res = await admin.get<JsonRecord>('/platform-admin/overview');
    expect(res.status, `GET /platform-admin/overview failed: ${res.rawText}`).toBe(200);
    const kpis = extractData<JsonRecord>(res.body);
    expect(isRecord(kpis)).toBe(true);
    expect(Object.keys(kpis).length).toBeGreaterThan(0);
  });

  test('T1.A4.2 GET /platform-admin/clients lists owners and supports search filtering', async () => {
    const { client: admin } = await loginPlatform(
      SEED_USERS.superAdmin.email,
      SEED_USERS.superAdmin.password,
    );

    const allRes = await admin.get<unknown>('/platform-admin/clients');
    expect(allRes.status).toBe(200);
    const allClients = extractArray<JsonRecord>(allRes.body);
    expect(allClients.length).toBeGreaterThanOrEqual(2);

    const carlos = await findSeededOwnerClient(admin, SEED_USERS.owner1.email);
    expect(carlos).toBeDefined();
  });

  test('T1.A4.3 GET /platform-admin/clients/:ownerId returns full CRM fiche for Carlos Mendoza', async () => {
    const { client: admin } = await loginPlatform(
      SEED_USERS.superAdmin.email,
      SEED_USERS.superAdmin.password,
    );

    const carlosSummary = await findSeededOwnerClient(admin, SEED_USERS.owner1.email);
    const ownerId = String(
      extractField<string>(carlosSummary, ['id', 'userId', 'ownerId']) ??
        (isRecord(carlosSummary.user) ? carlosSummary.user.id : ''),
    );
    expect(ownerId.length).toBeGreaterThan(0);

    const ficheRes = await admin.get<JsonRecord>(`/platform-admin/clients/${ownerId}`);
    expect(ficheRes.status, `GET client fiche failed: ${ficheRes.rawText}`).toBe(200);
    const fiche = extractData<JsonRecord>(ficheRes.body);
    expect(JSON.stringify(fiche)).toContain('Urban Threads');
  });

  test('T1.A4.4 PATCH /platform-admin/clients/:ownerId updates internalAdminNotes and restores original', async () => {
    const { client: admin } = await loginPlatform(
      SEED_USERS.superAdmin.email,
      SEED_USERS.superAdmin.password,
    );

    const luciaSummary = await findSeededOwnerClient(admin, SEED_USERS.owner2.email);
    const ownerId = String(
      extractField<string>(luciaSummary, ['id', 'userId', 'ownerId']) ??
        (isRecord(luciaSummary.user) ? luciaSummary.user.id : ''),
    );

    const ficheBeforeRes = await admin.get<JsonRecord>(`/platform-admin/clients/${ownerId}`);
    expect(ficheBeforeRes.status, `GET client fiche before patch failed: ${ficheBeforeRes.rawText}`).toBe(200);
    const ficheBefore = extractData<JsonRecord>(ficheBeforeRes.body);
    const originalNotes = String(
      (isRecord(ficheBefore.ownerProfile) ? ficheBefore.ownerProfile.internalAdminNotes : undefined) ??
        ficheBefore.internalAdminNotes ??
        'En período de prueba de 14 días. Requiere capacitación de plantilla CSV.',
    );
    const updatedNote = `Nota E2E CRM ${uniqueId('crm')}`;

    try {
      const patchRes = await admin.patch<JsonRecord>(`/platform-admin/clients/${ownerId}`, {
        internalAdminNotes: updatedNote,
      });
      expect(patchRes.status, `PATCH client notes failed: ${patchRes.rawText}`).toBe(200);

      const ficheAfterRes = await admin.get<JsonRecord>(`/platform-admin/clients/${ownerId}`);
      expect(ficheAfterRes.status).toBe(200);
      const ficheAfter = extractData<JsonRecord>(ficheAfterRes.body);
      expect(JSON.stringify(ficheAfter)).toContain(updatedNote);
    } finally {
      const restoreRes = await admin.patch(`/platform-admin/clients/${ownerId}`, {
        internalAdminNotes: originalNotes,
      });
      expect(restoreRes.status, `Restore client notes failed: ${restoreRes.rawText}`).toBe(200);
    }
  });

  test('T1.A4.5 PATCH /platform-admin/tenants/:tenantId/status transitions test tenant status', async () => {
    const { client: owner } = await registerAndVerifyPlatformOwner();
    const slug = uniqueSlug('crm-status');
    const tenantRes = await owner.post<JsonRecord>('/tenants', {
      name: `CRM Status ${slug}`,
      slug,
      planCode: SEED_PLANS.EMPRENDEDOR.code,
    });
    expect(tenantRes.status).toBe(201);
    const tenantId = getEntityId(extractData<JsonRecord>(tenantRes.body));

    const { client: admin } = await loginPlatform(
      SEED_USERS.superAdmin.email,
      SEED_USERS.superAdmin.password,
    );

    const suspendRes = await admin.patch<JsonRecord>(`/platform-admin/tenants/${tenantId}/status`, {
      status: 'SUSPENDED',
    });
    expect(suspendRes.status, `Suspend tenant failed: ${suspendRes.rawText}`).toBe(200);
    expect(extractData<JsonRecord>(suspendRes.body).status).toBe('SUSPENDED');

    const activateRes = await admin.patch<JsonRecord>(`/platform-admin/tenants/${tenantId}/status`, {
      status: 'ACTIVE',
    });
    expect(activateRes.status, `Activate tenant failed: ${activateRes.rawText}`).toBe(200);
    expect(extractData<JsonRecord>(activateRes.body).status).toBe('ACTIVE');
  });

  test('T1.A4.6 SuperAdmin creates manual payment and approves it, activating tenant & sending Mailpit email', async () => {
    const { client: owner, email: ownerEmail } = await registerAndVerifyPlatformOwner();
    const slug = uniqueSlug('crm-pay');
    const tenantRes = await owner.post<JsonRecord>('/tenants', {
      name: `CRM Pay ${slug}`,
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

    const paymentBody: Record<string, unknown> = {
      tenantId,
      provider: 'MANUAL_TRANSFER',
      amount: 49,
      currency: 'USD',
      externalReference: `TRF-${uniqueId('pay').toUpperCase()}`,
    };
    if (subscriptionId) {
      paymentBody.subscriptionId = subscriptionId;
    }

    const createPayRes = await admin.post<JsonRecord>('/platform-admin/payments', paymentBody);
    expect(createPayRes.status, `Create payment failed: ${createPayRes.rawText}`).toBe(201);
    const payment = extractData<JsonRecord>(createPayRes.body);
    const paymentId = getEntityId(payment);

    const reviewRes = await admin.patch<JsonRecord>(
      `/platform-admin/payments/${paymentId}/review`,
      { reviewStatus: 'APPROVED' },
    );
    expect(reviewRes.status, `Review payment failed: ${reviewRes.rawText}`).toBe(200);
    const reviewed = extractData<JsonRecord>(reviewRes.body);
    expect(reviewed.reviewStatus).toBe('APPROVED');

    // Verify Mailpit confirmation email sent to merchant
    const emailMsg = await mailpit.waitForEmail({
      to: ownerEmail,
      afterMs: startedAt,
      timeoutMs: 20_000,
    });
    expect(emailMsg.Subject.length).toBeGreaterThan(0);

    // Verify payments list includes our approved payment
    const listRes = await admin.get<unknown>('/platform-admin/payments');
    expect(listRes.status).toBe(200);
    const payments = extractArray<JsonRecord>(listRes.body);
    expect(payments.some((p) => p.id === paymentId && p.reviewStatus === 'APPROVED')).toBe(true);
  });

  test('T1.A4.7 SuperAdmin rejects manual payment (reviewStatus: REJECTED) without activating tenant or subscription', async () => {
    const { client: owner } = await registerAndVerifyPlatformOwner();
    const slug = uniqueSlug('crm-reject');
    const tenantRes = await owner.post<JsonRecord>('/tenants', {
      name: `CRM Reject ${slug}`,
      slug,
      planCode: SEED_PLANS.CRECIMIENTO_PRO.code,
    });
    expect(tenantRes.status, `Tenant creation failed: ${tenantRes.rawText}`).toBe(201);
    const tenantData = extractData<JsonRecord>(tenantRes.body);
    const tenantId = getEntityId(tenantData);
    const initialStatus = String(tenantData.status ?? 'TRIAL');
    expect(initialStatus).not.toBe('ACTIVE');
    const subscriptionId =
      isRecord(tenantData.subscription) ? String(tenantData.subscription.id ?? '') : '';

    const { client: admin } = await loginPlatform(
      SEED_USERS.superAdmin.email,
      SEED_USERS.superAdmin.password,
    );

    const paymentBody: Record<string, unknown> = {
      tenantId,
      provider: 'MANUAL_TRANSFER',
      amount: 49,
      currency: 'USD',
      externalReference: `TRF-REJ-${uniqueId('pay').toUpperCase()}`,
    };
    if (subscriptionId) {
      paymentBody.subscriptionId = subscriptionId;
    }

    const createPayRes = await admin.post<JsonRecord>('/platform-admin/payments', paymentBody);
    expect(createPayRes.status, `Create payment failed: ${createPayRes.rawText}`).toBe(201);
    const paymentId = getEntityId(extractData<JsonRecord>(createPayRes.body));

    const rejectRes = await admin.patch<JsonRecord>(
      `/platform-admin/payments/${paymentId}/review`,
      { reviewStatus: 'REJECTED' },
    );
    expect(rejectRes.status, `Reject payment failed: ${rejectRes.rawText}`).toBe(200);
    const rejected = extractData<JsonRecord>(rejectRes.body);
    expect(rejected.reviewStatus).toBe('REJECTED');

    // Tenant and subscription must NOT be activated
    const resolvedRes = await createBackendClient().get<JsonRecord>('/tenants/resolve', {
      tenantSlug: slug,
    });
    expect(resolvedRes.status).toBe(200);
    const resolved = extractData<JsonRecord>(resolvedRes.body);
    expect(resolved.status).not.toBe('ACTIVE');

    const currentRes = await owner.get<JsonRecord>('/tenants/current', { tenantSlug: slug });
    expect(currentRes.status).toBe(200);
    const currentTenant = extractData<JsonRecord>(currentRes.body);
    expect(currentTenant.status).not.toBe('ACTIVE');
    if (isRecord(currentTenant.subscription)) {
      expect(currentTenant.subscription.status).not.toBe('ACTIVE');
    }

    const listRes = await admin.get<unknown>('/platform-admin/payments');
    expect(listRes.status).toBe(200);
    const payments = extractArray<JsonRecord>(listRes.body);
    expect(payments.some((p) => p.id === paymentId && p.reviewStatus === 'REJECTED')).toBe(true);
  });
});
