import { expect, test } from '@playwright/test';
import { SEED_TENANTS, SEED_USERS, uniqueEmail } from '../../src/config/env';
import {
  assertRfc7807Error,
  extractData,
  type JsonRecord,
} from '../../src/helpers/assertions';
import { MailpitClient } from '../../src/helpers/mailpit-client';
import {
  buildResetPasswordPayload,
  buildVerifyOtpPayload,
  createBackendClient,
  loginPlatform,
  loginStoreCustomer,
  registerAndVerifyPlatformOwner,
  registerAndVerifyStoreCustomer,
} from '../../src/helpers/workflows';

async function waitForNewEmail(
  mailpit: MailpitClient,
  to: string,
  excludeIds: Set<string>,
  timeoutMs = 20_000,
) {
  const target = to.trim().toLowerCase();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const list = await mailpit.listMessages(50, 0);
    const match = list.messages.find(
      (msg) =>
        !excludeIds.has(msg.ID) &&
        (msg.To ?? []).some((addr) => addr.Address?.trim().toLowerCase() === target),
    );
    if (match) {
      return mailpit.getMessage(match.ID);
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Timed out waiting for a new email to "${to}" in Mailpit`);
}

test.describe('Tier 1 — A2: Authentication (Platform, Store, OTP/Mailpit, Refresh, Logout)', () => {
  test('T1.A2.1 GET /auth/capabilities returns non-blocking local-fallback or oauth mode', async () => {
    const api = createBackendClient();
    const res = await api.get<JsonRecord>('/auth/capabilities');

    expect(res.status).toBe(200);
    const data = extractData<JsonRecord>(res.body);
    expect(typeof data.googleEnabled).toBe('boolean');
    expect(['oauth', 'local-fallback']).toContain(data.mode);
    if (!data.googleEnabled) {
      expect(data.mode).toBe('local-fallback');
    }
  });

  test('T1.A2.2 Platform user registers, receives 6-digit OTP in Mailpit, and verifies email', async () => {
    const email = uniqueEmail('plat-otp');
    const api = createBackendClient();
    const mailpit = new MailpitClient();
    const startedAt = Date.now();

    const regRes = await api.post<JsonRecord>('/auth/platform/register', {
      email,
      password: 'OwnerPass123!',
      fullName: 'Lucia E2E Owner',
    });
    expect(regRes.status, `Register failed: ${regRes.rawText}`).toBe(201);

    const emailMsg = await mailpit.waitForEmail({
      to: email,
      afterMs: startedAt,
      timeoutMs: 20_000,
    });
    const otp = mailpit.extractOtpCode(emailMsg);
    expect(otp).toMatch(/^\d{6}$/);

    const verifyPayload = await buildVerifyOtpPayload(email, otp);
    const verifyRes = await api.post<JsonRecord>('/auth/platform/verify-otp', verifyPayload);
    expect([200, 201]).toContain(verifyRes.status);
  });

  test('T1.A2.3 Platform login sets HttpOnly SameSite=Lax cookies and GET /auth/me returns user', async () => {
    const { client, response } = await loginPlatform(
      SEED_USERS.owner1.email,
      SEED_USERS.owner1.password,
    );
    expect([200, 201]).toContain(response.status);

    const accessCookie = client.jar.get('access_token');
    const refreshCookie = client.jar.get('refresh_token');
    expect(accessCookie, 'access_token cookie must be set').toBeDefined();
    expect(refreshCookie, 'refresh_token cookie must be set').toBeDefined();
    expect(accessCookie?.httpOnly).toBe(true);
    expect(refreshCookie?.httpOnly).toBe(true);
    expect(accessCookie?.sameSite?.toLowerCase()).toBe('lax');

    const meRes = await client.get<JsonRecord>('/auth/me');
    expect(meRes.status).toBe(200);
    const me = extractData<JsonRecord>(meRes.body);
    expect(me.email).toBe(SEED_USERS.owner1.email);
    expect(me.role).toBe(SEED_USERS.owner1.role);
  });

  test('T1.A2.4 Store customer registers, verifies OTP via Mailpit, and logs in under moda-mayorista', async () => {
    const { email, client } = await registerAndVerifyStoreCustomer({
      tenantSlug: SEED_TENANTS.modaMayorista.slug,
      fullName: 'Comprador Tier1',
    });

    expect(client.jar.has('access_token')).toBe(true);
    expect(client.jar.has('refresh_token')).toBe(true);

    const meRes = await client.get<JsonRecord>('/auth/me', {
      tenantSlug: SEED_TENANTS.modaMayorista.slug,
    });
    expect(meRes.status).toBe(200);
    const me = extractData<JsonRecord>(meRes.body);
    expect(me.email).toBe(email);
  });

  test('T1.A2.5 Refresh token rotation issues new HttpOnly access_token and refresh_token cookies', async () => {
    const { client } = await loginPlatform(
      SEED_USERS.owner1.email,
      SEED_USERS.owner1.password,
    );
    const initialRefresh = client.jar.getValue('refresh_token');
    expect(initialRefresh).toBeTruthy();

    const refreshRes = await client.post<JsonRecord>('/auth/refresh');
    expect([200, 201], `Refresh failed: ${refreshRes.rawText}`).toContain(refreshRes.status);

    const rotatedRefresh = client.jar.getValue('refresh_token');
    expect(rotatedRefresh).toBeTruthy();
    expect(rotatedRefresh).not.toBe(initialRefresh);
    expect(client.jar.get('refresh_token')?.httpOnly).toBe(true);

    const meAfterRefresh = await client.get<JsonRecord>('/auth/me');
    expect(meAfterRefresh.status).toBe(200);
  });

  test('T1.A2.6 Logout clears auth cookies and invalidates session', async () => {
    const { client } = await loginPlatform(
      SEED_USERS.owner2.email,
      SEED_USERS.owner2.password,
    );

    const logoutRes = await client.post<JsonRecord>('/auth/logout');
    expect([200, 201]).toContain(logoutRes.status);

    expect(client.jar.has('access_token')).toBe(false);
    expect(client.jar.has('refresh_token')).toBe(false);

    const meAfterLogout = await client.get('/auth/me');
    assertRfc7807Error(meAfterLogout, 401);
  });

  test('T1.A2.7 Platform forgot-password sends OTP/token via Mailpit and reset-password updates password', async () => {
    const { email, password } = await registerAndVerifyPlatformOwner();
    const api = createBackendClient();
    const mailpit = new MailpitClient();
    const startedAt = Date.now();

    const forgotRes = await api.post<JsonRecord>('/auth/platform/forgot-password', { email });
    expect([200, 201]).toContain(forgotRes.status);

    const allMessages = await mailpit.listMessages();
    const myMessages = allMessages.messages.filter(m => m.To.some(t => t.Address === email));
    // Assuming messages are returned newest first, or just take the last one by time
    const resetMsg = await mailpit.waitForEmail({
      to: email,
      subjectIncludes: 'Restablece tu contraseña',
      afterMs: startedAt,
      timeoutMs: 20_000,
    });
    
    const resetTokenOrOtp = mailpit.extractResetTokenOrOtp(resetMsg);
    console.log('DEBUG: resetTokenOrOtp', resetTokenOrOtp);
    const newPassword = 'NewOwnerPass456!';

    const resetPayload = await buildResetPasswordPayload(email, resetTokenOrOtp, newPassword);
    const resetRes = await api.post<JsonRecord>('/auth/platform/reset-password', resetPayload);
    expect([200, 201], `Reset password failed: ${resetRes.rawText}`).toContain(resetRes.status);

    // Old password must fail, new password must succeed
    const oldLogin = await createBackendClient().post('/auth/platform/login', {
      email,
      password,
    });
    assertRfc7807Error(oldLogin, 401);

    await loginPlatform(email, newPassword);
  });

  test('T1.A2.8 Platform and Store resend-otp deliver fresh OTPs via Mailpit and verify accounts', async () => {
    const mailpit = new MailpitClient();

    // 1. Platform resend-otp with fresh ephemeral owner
    const platEmail = uniqueEmail('plat-resend');
    const platPassword = 'OwnerResend123!';
    const platClient = createBackendClient();
    const platStarted = Date.now();

    const platReg = await platClient.post<JsonRecord>('/auth/platform/register', {
      email: platEmail,
      password: platPassword,
      fullName: 'Platform Resend Owner',
    });
    expect(platReg.status, `Platform register failed: ${platReg.rawText}`).toBe(201);

    const platFirstMsg = await mailpit.waitForEmail({
      to: platEmail,
      afterMs: platStarted,
      timeoutMs: 20_000,
    });

    const platResendRes = await platClient.post<JsonRecord>('/auth/platform/resend-otp', {
      email: platEmail,
    });
    expect([200, 201], `Platform resend-otp failed: ${platResendRes.rawText}`).toContain(
      platResendRes.status,
    );

    const platSecondMsg = await waitForNewEmail(mailpit, platEmail, new Set([platFirstMsg.ID]));
    const platResentOtp = mailpit.extractOtpCode(platSecondMsg);
    expect(platResentOtp).toMatch(/^\d{6}$/);

    const platVerifyRes = await platClient.post<JsonRecord>(
      '/auth/platform/verify-otp',
      await buildVerifyOtpPayload(platEmail, platResentOtp),
    );
    expect([200, 201], `Platform verify resent OTP failed: ${platVerifyRes.rawText}`).toContain(
      platVerifyRes.status,
    );
    await loginPlatform(platEmail, platPassword);

    // 2. Store resend-otp with fresh ephemeral customer under moda-mayorista
    const storeEmail = uniqueEmail('store-resend');
    const storePassword = 'BuyerResend123!';
    const storeClient = createBackendClient();
    const storeStarted = Date.now();

    const storeReg = await storeClient.post<JsonRecord>(
      '/auth/store/register',
      {
        email: storeEmail,
        password: storePassword,
        fullName: 'Store Resend Buyer',
      },
      { tenantSlug: SEED_TENANTS.modaMayorista.slug },
    );
    expect(storeReg.status, `Store register failed: ${storeReg.rawText}`).toBe(201);

    const storeFirstMsg = await mailpit.waitForEmail({
      to: storeEmail,
      afterMs: storeStarted,
      timeoutMs: 20_000,
    });

    const storeResendRes = await storeClient.post<JsonRecord>(
      '/auth/store/resend-otp',
      { email: storeEmail },
      { tenantSlug: SEED_TENANTS.modaMayorista.slug },
    );
    expect([200, 201], `Store resend-otp failed: ${storeResendRes.rawText}`).toContain(
      storeResendRes.status,
    );

    const storeSecondMsg = await waitForNewEmail(mailpit, storeEmail, new Set([storeFirstMsg.ID]));
    const storeResentOtp = mailpit.extractOtpCode(storeSecondMsg);
    expect(storeResentOtp).toMatch(/^\d{6}$/);

    const storeVerifyRes = await storeClient.post<JsonRecord>(
      '/auth/store/verify-otp',
      await buildVerifyOtpPayload(storeEmail, storeResentOtp),
      { tenantSlug: SEED_TENANTS.modaMayorista.slug },
    );
    expect([200, 201], `Store verify resent OTP failed: ${storeVerifyRes.rawText}`).toContain(
      storeVerifyRes.status,
    );
    await loginStoreCustomer(storeEmail, storePassword, SEED_TENANTS.modaMayorista.slug);
  });

  test('T1.A2.9 Store forgot-password sends OTP/token via Mailpit and reset-password updates password', async () => {
    const mailpit = new MailpitClient();
    const { email, password } = await registerAndVerifyStoreCustomer({
      tenantSlug: SEED_TENANTS.modaMayorista.slug,
      fullName: 'Store Reset Buyer',
    });

    // Record any existing emails for this unique ephemeral address so we only pick the reset email
    const existingList = await mailpit.listMessages(50, 0);
    const seenIds = new Set(
      existingList.messages
        .filter((m) => (m.To ?? []).some((a) => a.Address?.trim().toLowerCase() === email))
        .map((m) => m.ID),
    );

    const api = createBackendClient();
    const forgotRes = await api.post<JsonRecord>(
      '/auth/store/forgot-password',
      { email },
      { tenantSlug: SEED_TENANTS.modaMayorista.slug },
    );
    expect([200, 201], `Store forgot-password failed: ${forgotRes.rawText}`).toContain(
      forgotRes.status,
    );

    const resetMsg = await waitForNewEmail(mailpit, email, seenIds);
    const resetTokenOrOtp = mailpit.extractResetTokenOrOtp(resetMsg);
    const newPassword = 'NewBuyerPass456!';

    const resetPayload = await buildResetPasswordPayload(email, resetTokenOrOtp, newPassword);
    const resetRes = await api.post<JsonRecord>('/auth/store/reset-password', resetPayload, {
      tenantSlug: SEED_TENANTS.modaMayorista.slug,
    });
    expect([200, 201], `Store reset-password failed: ${resetRes.rawText}`).toContain(
      resetRes.status,
    );

    const oldLogin = await createBackendClient().post(
      '/auth/store/login',
      { email, password },
      { tenantSlug: SEED_TENANTS.modaMayorista.slug },
    );
    assertRfc7807Error(oldLogin, 401);

    await loginStoreCustomer(email, newPassword, SEED_TENANTS.modaMayorista.slug);
  });
});
