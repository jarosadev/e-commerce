import { expect, test } from '@playwright/test';
import {
  assertOpenApi3Document,
  assertRfc7807Error,
  extractData,
} from '../../src/helpers/assertions';
import { attachBrowserGuard } from '../../src/helpers/browser-helpers';
import { CookieJar, HttpClient, type HttpResponse } from '../../src/helpers/http-client';
import { MailpitClient, stripHtml } from '../../src/helpers/mailpit-client';
import { startMockStack, type MockStackUrls } from '../../src/self/mock-stack';

test.describe('E2E Harness Self-Test (Offline In-Process Mock Stack)', () => {
  let stack: MockStackUrls;

  test.beforeAll(async () => {
    stack = await startMockStack();
  });

  test.afterAll(async () => {
    await stack.close();
  });

  test('HttpClient validates /health and OpenAPI 3.x document', async () => {
    const api = new HttpClient({ baseUrl: stack.apiBaseUrl });
    const health = await api.get<{ status: string; db: string; redis: string }>('/health');
    expect(health.status).toBe(200);
    expect(health.body.status).toBe('ok');
    expect(health.body.db).toBe('up');
    expect(health.body.redis).toBe('up');

    const root = new HttpClient({ baseUrl: stack.backendBaseUrl });
    const openApiRes = await root.get('/api/docs-json');
    expect(openApiRes.status).toBe(200);
    assertOpenApi3Document(openApiRes.body);
  });

  test('MailpitClient polls mock Mailpit and extracts 6-digit OTP from email', async () => {
    const api = new HttpClient({ baseUrl: stack.apiBaseUrl });
    const mailpit = new MailpitClient(stack.mailpitApiUrl);
    const email = 'self-otp@test.local';
    const startedAt = Date.now();

    const reg = await api.post('/auth/platform/register', {
      email,
      password: 'Password123!',
      fullName: 'Self Test User',
    });
    expect(reg.status).toBe(201);

    const msg = await mailpit.waitForEmail({
      to: email,
      subjectIncludes: 'Verifica',
      afterMs: startedAt,
      timeoutMs: 5_000,
    });
    const otp = mailpit.extractOtpCode(msg);
    expect(otp).toMatch(/^\d{6}$/);

    const verify = await api.post('/auth/platform/verify-otp', { email, otp });
    expect(verify.status).toBe(200);
    expect(extractData<{ verified: boolean }>(verify.body).verified).toBe(true);
  });

  test('CookieJar inspects HttpOnly/SameSite attributes, rotates tokens, and detects replay', async () => {
    const api = new HttpClient({ baseUrl: stack.apiBaseUrl });
    const login = await api.post('/auth/platform/login', {
      email: 'self-cookie@test.local',
      password: 'Password123!',
    });
    expect(login.status).toBe(200);

    const accessCookie = api.jar.get('access_token');
    const refreshCookie = api.jar.get('refresh_token');
    expect(accessCookie?.httpOnly).toBe(true);
    expect(accessCookie?.sameSite?.toLowerCase()).toBe('lax');
    expect(refreshCookie?.httpOnly).toBe(true);

    const r1Snapshot = api.jar.snapshot();

    const refresh1 = await api.post('/auth/refresh');
    expect(refresh1.status).toBe(200);
    const r2Value = api.jar.getValue('refresh_token');
    expect(r2Value).toBeTruthy();
    expect(r2Value).not.toBe(refreshCookie?.value);

    const r2Snapshot = api.jar.snapshot();

    // Replay R1 manually -> must fail 401 and revoke entire family
    api.jar.restore(r1Snapshot);
    const replayR1 = await api.post('/auth/refresh');
    assertRfc7807Error(replayR1, 401, 'revoked');

    // Subsequent attempt with R2 must also fail 401
    api.jar.restore(r2Snapshot);
    const useR2AfterRevocation = await api.post('/auth/refresh');
    assertRfc7807Error(useR2AfterRevocation, 401);

    // Logout clears cookies via Max-Age=0
    const logout = await api.post('/auth/logout');
    expect(logout.status).toBe(200);
    expect(api.jar.has('access_token')).toBe(false);
    expect(api.jar.has('refresh_token')).toBe(false);
  });

  test('HttpClient sends x-tenant-host and assertRfc7807Error validates structured errors', async () => {
    const api = new HttpClient({ baseUrl: stack.apiBaseUrl });

    const validTenant = await api.get<{ tenant: { slug: string } }>('/storefront/config', {
      tenantHost: 'moda-mayorista.localhost:3000',
    });
    expect(validTenant.status).toBe(200);
    expect(validTenant.body.tenant.slug).toBe('moda-mayorista');

    const unknownTenant = await api.get('/storefront/config', {
      tenantHost: 'missing.localhost:3000',
    });
    assertRfc7807Error(unknownTenant, 404, 'not found');

    const validationErr = await api.post('/auth/platform/register', {
      email: 'bad@test.local',
      unexpectedRole: 'SUPER_ADMIN',
    });
    assertRfc7807Error(validationErr, 400, 'unexpectedRole');
  });

  test('Playwright headless Chromium renders mock storefront cleanly with BrowserGuard', async ({ page }) => {
    const guard = attachBrowserGuard(page);
    const response = await page.goto(`${stack.frontendUrl}/store/moda-mayorista`, {
      waitUntil: 'domcontentloaded',
    });
    expect(response?.status()).toBe(200);
    await expect(page.locator('h1')).toContainText('Urban Threads Studio');
    await expect(page.locator('body')).toContainText('Hoodie Boxy Heavyweight 450gsm');
    guard.assertClean();
  });

  test('Helper edge cases: RFC7807 empty message array, OpenAPI empty title, numeric HTML entities, and empty Set-Cookie clearing', async () => {
    // 1. assertRfc7807Error rejects empty/whitespace strings inside message array
    for (const badMessage of [[''], ['valid', '   ']]) {
      const fakeResponse: HttpResponse<unknown> = {
        status: 400,
        ok: false,
        headers: new Headers(),
        setCookies: [],
        body: {
          statusCode: 400,
          error: 'Bad Request',
          message: badMessage,
          path: '/api/v1/test',
          timestamp: new Date().toISOString(),
          requestId: 'req-123',
        },
        rawText: JSON.stringify({ message: badMessage }),
      };
      expect(() => assertRfc7807Error(fakeResponse, 400)).toThrow();
    }

    // 2. assertOpenApi3Document rejects empty/whitespace info.title
    for (const badTitle of ['', '   ']) {
      expect(() =>
        assertOpenApi3Document({
          openapi: '3.0.3',
          info: { title: badTitle, version: '1.0.0' },
          paths: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`/p${i}`, {}])),
          components: { schemas: { Ok: { type: 'object' } } },
        }),
      ).toThrow();
    }

    // 3. Mailpit stripHtml/extractOtpCode decode/strip numeric HTML entities before OTP
    const mailpit = new MailpitClient(stack.mailpitApiUrl);
    const htmlWithNumericEntities =
      '<p>Icon &#100023; Hex &#x186B7; Overflow &#9999999; Tu código es <strong>827364</strong></p>';
    const stripped = stripHtml(htmlWithNumericEntities);
    expect(stripped).not.toContain('100023');
    expect(stripped).not.toContain('9999999');
    expect(mailpit.extractOtpCode({ Text: '', HTML: htmlWithNumericEntities })).toBe('827364');

    // 4. CookieJar deletes cookie on empty value even without Max-Age=0 or Expires
    const jar = new CookieJar();
    jar.set('access_token', 'active-token');
    expect(jar.has('access_token')).toBe(true);
    jar.applySetCookies(['access_token=; Path=/; HttpOnly; SameSite=Lax']);
    expect(jar.has('access_token')).toBe(false);
    expect(jar.toCookieHeader()).toBe('');
  });
});
