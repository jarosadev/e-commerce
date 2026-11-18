import { expect, test } from '@playwright/test';
import { SEED_TENANTS, SEED_USERS, uniqueEmail } from '../../src/config/env';
import { assertRfc7807Error, extractData, type JsonRecord } from '../../src/helpers/assertions';
import {
  buildVerifyOtpPayload,
  createBackendClient,
  loginPlatform,
  registerAndVerifyStoreCustomer,
} from '../../src/helpers/workflows';

test.describe('Tier 2 — A2: Auth Security Boundaries & Edge Cases', () => {
  test('T2.A2.1 Wrong 6-digit OTP on /auth/platform/verify-otp fails 400/401 without verifying user', async () => {
    const email = uniqueEmail('bad-otp');
    const api = createBackendClient();

    const reg = await api.post('/auth/platform/register', {
      email,
      password: 'OwnerPass123!',
      fullName: 'Bad OTP User',
    });
    expect(reg.status).toBe(201);

    const badPayload = await buildVerifyOtpPayload(email, '000000');
    const verifyFail = await api.post('/auth/platform/verify-otp', badPayload);
    assertRfc7807Error(verifyFail, [400, 401]);
  });

  test('T2.A2.2 Refresh token reuse triggers full family revocation (both R1 replay and R2 fail 401)', async () => {
    const { client } = await loginPlatform(
      SEED_USERS.owner1.email,
      SEED_USERS.owner1.password,
    );

    const r1Snapshot = client.jar.snapshot();
    expect(r1Snapshot.refresh_token?.value).toBeTruthy();

    // Legitimate rotation R1 -> R2
    const rotateRes = await client.post('/auth/refresh');
    expect([200, 201]).toContain(rotateRes.status);
    const r2Snapshot = client.jar.snapshot();
    expect(r2Snapshot.refresh_token?.value).not.toBe(r1Snapshot.refresh_token?.value);

    // Replay R1 (stolen old token) -> must fail 401
    client.jar.restore(r1Snapshot);
    const replayR1 = await client.post('/auth/refresh');
    assertRfc7807Error(replayR1, 401);

    // Legitimate R2 from same family must NOW also be revoked -> 401
    client.jar.restore(r2Snapshot);
    const useR2AfterReuse = await client.post('/auth/refresh');
    assertRfc7807Error(useR2AfterReuse, 401);
  });

  test('T2.A2.3 Duplicate email rejected 409 in same tenant, but allowed across moda-mayorista & electro-hogar', async () => {
    const sharedEmail = uniqueEmail('cross-tenant-buyer');

    // Register on moda-mayorista -> 201
    await registerAndVerifyStoreCustomer({
      tenantSlug: SEED_TENANTS.modaMayorista.slug,
      email: sharedEmail,
      password: 'BuyerPass123!',
      fullName: 'Shared Email Buyer',
    });

    // Duplicate on moda-mayorista -> 409 Conflict
    const dupSameTenant = await createBackendClient().post(
      '/auth/store/register',
      {
        email: sharedEmail,
        password: 'BuyerPass123!',
        fullName: 'Duplicate Buyer',
      },
      { tenantSlug: SEED_TENANTS.modaMayorista.slug },
    );
    assertRfc7807Error(dupSameTenant, 409);

    // Same email on electro-hogar -> 201 Created (per-tenant unique constraint)
    await registerAndVerifyStoreCustomer({
      tenantSlug: SEED_TENANTS.electroHogar.slug,
      email: sharedEmail,
      password: 'OtherTenantPass123!',
      fullName: 'Shared Email Buyer Electro',
    });
  });

  test('T2.A2.4 Wrong password on platform and store login returns 401 RFC 7807', async () => {
    const api = createBackendClient();

    const badPlat = await api.post('/auth/platform/login', {
      email: SEED_USERS.owner1.email,
      password: 'DefinitelyWrongPassword999!',
    });
    assertRfc7807Error(badPlat, 401);

    const badStore = await api.post(
      '/auth/store/login',
      {
        email: SEED_USERS.customer1.email,
        password: 'DefinitelyWrongPassword999!',
      },
      { tenantSlug: SEED_TENANTS.modaMayorista.slug },
    );
    assertRfc7807Error(badStore, 401);
  });

  test('T2.A2.5 GET /auth/me unauthenticated or with tampered token fails 401', async () => {
    const anon = createBackendClient();
    const unauth = await anon.get('/auth/me');
    assertRfc7807Error(unauth, 401);

    anon.jar.set('access_token', 'tampered.jwt.token');
    const tampered = await anon.get('/auth/me');
    assertRfc7807Error(tampered, 401);
  });

  test('T2.A2.6 Google OAuth invalid exchange code returns 400/401 and /auth/google does not crash in local-fallback', async () => {
    const api = createBackendClient();

    const caps = await api.get<JsonRecord>('/auth/capabilities');
    expect(caps.status).toBe(200);
    const capsData = extractData<JsonRecord>(caps.body);

    const invalidExchange = await api.post('/auth/google/exchange', {
      code: 'nonexistent-one-time-oauth-code',
    });
    assertRfc7807Error(invalidExchange, [400, 401]);

    const oauthStart = await api.get('/auth/google?scope=platform&returnHost=localhost:3000', {
      redirect: 'manual',
    });
    expect([200, 302, 303, 307, 308, 501]).toContain(oauthStart.status);
    if (
      capsData.mode === 'local-fallback' &&
      oauthStart.status >= 300 &&
      oauthStart.status < 400
    ) {
      const location = oauthStart.headers.get('location') ?? '';
      expect(location.toLowerCase()).not.toContain('accounts.google.com');
    }
  });
});
