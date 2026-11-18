import { Controller, Get, INestApplication, UseGuards, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PlatformRole, TenantStatus } from '@prisma/client';
import cookieParser from 'cookie-parser';
import { createHash } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { Public } from '../src/common/decorators/public.decorator';
import {
  RequirePlanFeature,
  RequirePlanQuota,
} from '../src/common/decorators/require-plan.decorator';
import { RequireTenant } from '../src/common/decorators/require-tenant.decorator';
import { PrismaService } from '../src/database/prisma.service';
import { PlanQuotaGuard } from '../src/modules/plans/guards/plan-quota.guard';
import { RedisService } from '../src/redis/redis.module';

@Controller('__m2-quota-probe')
class M2PlanQuotaProbeController {
  @Get('custom-domain')
  @Public()
  @RequireTenant()
  @UseGuards(PlanQuotaGuard)
  @RequirePlanFeature('allowCustomDomain')
  checkCustomDomain() {
    return { allowed: true };
  }

  @Get('staff-quota')
  @Public()
  @RequireTenant()
  @UseGuards(PlanQuotaGuard)
  @RequirePlanQuota('staff')
  checkStaffQuota() {
    return { allowed: true };
  }
}

interface MailpitListResponse {
  messages: Array<{
    ID: string;
    Subject: string;
    To: Array<{ Address: string }>;
  }>;
}

interface MailpitDetailResponse {
  ID: string;
  Subject: string;
  Text: string;
  HTML: string;
}

const MAILPIT_URL = 'http://localhost:8025';

async function waitForMailpitOtp(
  toEmail: string,
  excludeIds: Set<string> = new Set(),
  timeoutMs = 15_000,
): Promise<{ messageId: string; otp: string }> {
  const target = toEmail.trim().toLowerCase();
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const listRes = await fetch(`${MAILPIT_URL}/api/v1/messages?limit=50&start=0`);
    const list = (await listRes.json()) as MailpitListResponse;
    const match = list.messages.find(
      (m) =>
        !excludeIds.has(m.ID) && m.To.some((addr) => addr.Address?.trim().toLowerCase() === target),
    );
    if (match) {
      const detailRes = await fetch(`${MAILPIT_URL}/api/v1/message/${match.ID}`);
      const detail = (await detailRes.json()) as MailpitDetailResponse;
      const otpMatch = /\b(\d{6})\b/.exec(detail.Text || detail.HTML);
      if (!otpMatch) {
        throw new Error(`Email ${match.ID} to ${toEmail} did not contain 6-digit OTP`);
      }
      return { messageId: match.ID, otp: otpMatch[1] };
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  throw new Error(`Timed out waiting for Mailpit email to ${toEmail}`);
}

function extractCookiesMap(
  setCookieHeader: unknown,
): Record<string, { raw: string; value: string }> {
  const list = Array.isArray(setCookieHeader)
    ? (setCookieHeader as string[])
    : typeof setCookieHeader === 'string'
      ? [setCookieHeader]
      : [];
  const map: Record<string, { raw: string; value: string }> = {};
  for (const raw of list) {
    const [pair] = raw.split(';');
    const eqIdx = pair.indexOf('=');
    if (eqIdx > 0) {
      const name = pair.slice(0, eqIdx).trim();
      const value = pair.slice(eqIdx + 1).trim();
      map[name] = { raw, value };
    }
  }
  return map;
}

describe('M2 Auth, Plans & Tenants (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;

  const cleanupTenantIds: string[] = [];
  const cleanupPlatformUserIds: string[] = [];
  const cleanupCustomerIds: string[] = [];
  const cleanupPlanIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [M2PlanQuotaProbeController],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );

    await app.init();

    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
  });

  afterAll(async () => {
    if (prisma) {
      if (cleanupTenantIds.length > 0) {
        await prisma.tenant.deleteMany({ where: { id: { in: cleanupTenantIds } } });
      }
      if (cleanupCustomerIds.length > 0) {
        await prisma.storeCustomer.deleteMany({ where: { id: { in: cleanupCustomerIds } } });
      }
      if (cleanupPlatformUserIds.length > 0) {
        await prisma.platformUser.deleteMany({ where: { id: { in: cleanupPlatformUserIds } } });
      }
      if (cleanupPlanIds.length > 0) {
        await prisma.plan.deleteMany({ where: { id: { in: cleanupPlanIds } } });
      }
    }
    if (redis) {
      await redis.delByPattern('auth:*');
      await redis.delByPattern('tenant:host:*');
      await redis.delByPattern('tenant:slug:*');
    }
    await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: 'DELETE' }).catch(() => undefined);
    if (app) {
      await app.close();
    }
  });

  it('F4 Google OAuth capabilities, non-blocking local-fallback, open-redirect guard & invalid exchange', async () => {
    const capsRes = await request(app.getHttpServer()).get('/api/v1/auth/capabilities').expect(200);
    expect(capsRes.body).toEqual({
      googleEnabled: false,
      mode: 'local-fallback',
    });

    const googleStart = await request(app.getHttpServer())
      .get('/api/v1/auth/google?scope=platform&returnHost=localhost:3000')
      .expect(302);
    expect(googleStart.headers.location).toContain('/login?oauth=unavailable&mode=local-fallback');
    expect(googleStart.headers.location.toLowerCase()).not.toContain('accounts.google.com');

    for (const badHost of [
      'evil.example.com',
      '.localhost:3000',
      'localhost:abc',
      'localhost:3000.evil.com',
      'sub.moda-mayorista.localhost:3000',
    ]) {
      await request(app.getHttpServer())
        .get(`/api/v1/auth/google?scope=platform&returnHost=${encodeURIComponent(badHost)}`)
        .expect(400);
    }

    const badExchange = await request(app.getHttpServer())
      .post('/api/v1/auth/google/exchange')
      .send({ code: 'invalid-one-time-code' })
      .expect(401);
    expect(badExchange.headers['set-cookie']).toBeUndefined();
  });

  it('F4 Platform register, OTP verify/resend, login cookies, refresh family revocation, forgot/reset & logout', async () => {
    const suffix = Date.now();
    const email = `m2-owner-${suffix}@vendexa.local`;
    const password = 'OwnerM2Pass123!';
    const newPassword = 'OwnerM2NewPass456!';

    // Reject privilege escalation role field
    await request(app.getHttpServer())
      .post('/api/v1/auth/platform/register')
      .send({
        email,
        password,
        fullName: 'M2 Owner',
        role: PlatformRole.SUPER_ADMIN,
      })
      .expect(400);

    const regRes = await request(app.getHttpServer())
      .post('/api/v1/auth/platform/register')
      .send({
        email,
        password,
        fullName: 'M2 Owner',
      })
      .expect(201);
    cleanupPlatformUserIds.push(regRes.body.id);
    expect(regRes.body.role).toBe(PlatformRole.STORE_OWNER);
    expect(regRes.body.passwordHash).toBeUndefined();

    const firstMail = await waitForMailpitOtp(email);

    // Unverified login returns 403
    await request(app.getHttpServer())
      .post('/api/v1/auth/platform/login')
      .send({ email, password })
      .expect(403);

    // Resend OTP delivers new code
    await request(app.getHttpServer())
      .post('/api/v1/auth/platform/resend-otp')
      .send({ email })
      .expect(200);

    const secondMail = await waitForMailpitOtp(email, new Set([firstMail.messageId]));

    // Wrong OTP -> 401
    await request(app.getHttpServer())
      .post('/api/v1/auth/platform/verify-otp')
      .send({ email, otp: secondMail.otp === '000000' ? '111111' : '000000' })
      .expect(401);

    // Verify valid OTP -> 200
    await request(app.getHttpServer())
      .post('/api/v1/auth/platform/verify-otp')
      .send({ email, otp: secondMail.otp })
      .expect(200);

    // Create a suspended tenant to ensure suspended host header never blocks platform auth
    const suspendedSlug = `m2-susp-${suffix}`;
    const suspTenant = await prisma.tenant.create({
      data: {
        slug: suspendedSlug,
        name: 'Suspended Test Store',
        ownerId: regRes.body.id,
        status: TenantStatus.SUSPENDED,
      },
    });
    cleanupTenantIds.push(suspTenant.id);

    // Login -> 200 + HttpOnly SameSite=Lax cookies (works even with suspended x-tenant-host)
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/platform/login')
      .set('x-tenant-host', `${suspendedSlug}.localhost:3000`)
      .send({ email, password })
      .expect(200);

    const cookies1 = extractCookiesMap(loginRes.headers['set-cookie']);
    expect(cookies1.access_token?.raw).toContain('HttpOnly');
    expect(cookies1.access_token?.raw).toContain('SameSite=Lax');
    expect(cookies1.refresh_token?.raw).toContain('HttpOnly');

    const meRes = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('x-tenant-host', `${suspendedSlug}.localhost:3000`)
      .set('Cookie', [`access_token=${cookies1.access_token.value}`])
      .expect(200);
    expect(meRes.body.email).toBe(email);
    expect(meRes.body.passwordHash).toBeUndefined();

    // Refresh rotation R1 -> R2
    const r1Value = cookies1.refresh_token.value;
    const refreshRes = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', [`refresh_token=${r1Value}`])
      .expect(200);
    const cookies2 = extractCookiesMap(refreshRes.headers['set-cookie']);
    const r2Value = cookies2.refresh_token.value;
    expect(r2Value).toBeTruthy();
    expect(r2Value).not.toBe(r1Value);

    // Reuse R1 -> 401 and revokes entire family including R2
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', [`refresh_token=${r1Value}`])
      .expect(401);

    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', [`refresh_token=${r2Value}`])
      .expect(401);

    // Forgot & reset password
    const seenIds = new Set([firstMail.messageId, secondMail.messageId]);
    await request(app.getHttpServer())
      .post('/api/v1/auth/platform/forgot-password')
      .send({ email })
      .expect(200);

    const resetMail = await waitForMailpitOtp(email, seenIds);
    await request(app.getHttpServer())
      .post('/api/v1/auth/platform/reset-password')
      .send({ email, otp: resetMail.otp, newPassword })
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/v1/auth/platform/login')
      .send({ email, password })
      .expect(401);

    const relogin = await request(app.getHttpServer())
      .post('/api/v1/auth/platform/login')
      .send({ email, password: newPassword })
      .expect(200);
    const cookies3 = extractCookiesMap(relogin.headers['set-cookie']);

    // Logout returns exact 200 and clears cookies
    const logoutRes = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Cookie', [`refresh_token=${cookies3.refresh_token.value}`])
      .expect(200);
    expect(logoutRes.body).toEqual({ loggedOut: true });
    const cleared = extractCookiesMap(logoutRes.headers['set-cookie']);
    expect(cleared.access_token?.value).toBe('');
    expect(cleared.refresh_token?.value).toBe('');
  });

  it('F4 StoreCustomer per-tenant uniqueness, cross-tenant isolation, OTP & password reset without welcome race', async () => {
    const suffix = Date.now();
    const sharedEmail = `m2-buyer-${suffix}@vendexa.local`;
    const password = 'BuyerM2Pass123!';
    const newPassword = 'BuyerM2Reset456!';

    const cust1Res = await request(app.getHttpServer())
      .post('/api/v1/auth/store/register')
      .set('x-tenant-slug', 'moda-mayorista')
      .send({ email: sharedEmail, password, fullName: 'Buyer Moda' })
      .expect(201);
    cleanupCustomerIds.push(cust1Res.body.id);

    // Duplicate within same tenant -> 409
    await request(app.getHttpServer())
      .post('/api/v1/auth/store/register')
      .set('x-tenant-slug', 'moda-mayorista')
      .send({ email: sharedEmail, password, fullName: 'Dup Buyer' })
      .expect(409);

    // Same email allowed on electro-hogar -> 201
    const cust2Res = await request(app.getHttpServer())
      .post('/api/v1/auth/store/register')
      .set('x-tenant-slug', 'electro-hogar')
      .send({ email: sharedEmail, password, fullName: 'Buyer Electro' })
      .expect(201);
    cleanupCustomerIds.push(cust2Res.body.id);

    const modaOtp = await waitForMailpitOtp(sharedEmail);
    await request(app.getHttpServer())
      .post('/api/v1/auth/store/verify-otp')
      .set('x-tenant-slug', 'moda-mayorista')
      .send({ email: sharedEmail, otp: modaOtp.otp })
      .expect(200);

    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/store/login')
      .set('x-tenant-slug', 'moda-mayorista')
      .send({ email: sharedEmail, password })
      .expect(200);
    const cookies = extractCookiesMap(loginRes.headers['set-cookie']);

    // Customer token works on moda-mayorista, rejected 401 on electro-hogar
    const meModa = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('x-tenant-slug', 'moda-mayorista')
      .set('Cookie', [`access_token=${cookies.access_token.value}`])
      .expect(200);
    expect(meModa.body.actorType).toBe('CUSTOMER');
    expect(meModa.body.role).toBe('CUSTOMER');

    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('x-tenant-slug', 'electro-hogar')
      .set('Cookie', [`access_token=${cookies.access_token.value}`])
      .expect(401);

    // Store forgot-password & reset-password (ensure no delayed welcome email races Mailpit)
    const listBefore = await fetch(`${MAILPIT_URL}/api/v1/messages?limit=50&start=0`);
    const beforeJson = (await listBefore.json()) as MailpitListResponse;
    const seenIds = new Set(beforeJson.messages.map((m) => m.ID));

    await request(app.getHttpServer())
      .post('/api/v1/auth/store/forgot-password')
      .set('x-tenant-slug', 'moda-mayorista')
      .send({ email: sharedEmail })
      .expect(200);

    const resetMail = await waitForMailpitOtp(sharedEmail, seenIds);
    await request(app.getHttpServer())
      .post('/api/v1/auth/store/reset-password')
      .set('x-tenant-slug', 'moda-mayorista')
      .send({ email: sharedEmail, otp: resetMail.otp, newPassword })
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/v1/auth/store/login')
      .set('x-tenant-slug', 'moda-mayorista')
      .send({ email: sharedEmail, password })
      .expect(401);

    await request(app.getHttpServer())
      .post('/api/v1/auth/store/login')
      .set('x-tenant-slug', 'moda-mayorista')
      .send({ email: sharedEmail, password: newPassword })
      .expect(200);
  });

  it('F5 Plans CRUD, validation, RBAC, and PlanQuotaGuard enforcement', async () => {
    const publicPlansRes = await request(app.getHttpServer()).get('/api/v1/plans').expect(200);
    expect(Array.isArray(publicPlansRes.body)).toBe(true);
    expect(publicPlansRes.body.map((p: { code: string }) => p.code)).toEqual(
      expect.arrayContaining(['EMPRENDEDOR', 'CRECIMIENTO_PRO', 'MAYORISTA_ENTERPRISE']),
    );

    const ownerLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/platform/login')
      .send({ email: 'carlos@urbanthreads.local', password: 'Owner1234!' })
      .expect(200);
    const ownerCookies = extractCookiesMap(ownerLogin.headers['set-cookie']);

    // Non-SuperAdmin rejected 403
    await request(app.getHttpServer())
      .post('/api/v1/platform-admin/plans')
      .set('Cookie', [`access_token=${ownerCookies.access_token.value}`])
      .send({
        code: 'NO_ACCESS',
        name: 'No Access',
        priceMonthly: 10,
        priceYearly: 100,
        maxProducts: 10,
        maxStaff: 1,
      })
      .expect(403);

    const adminLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/platform/login')
      .send({ email: 'admin@vendexa.local', password: 'Admin1234!' })
      .expect(200);
    const adminCookies = extractCookiesMap(adminLogin.headers['set-cookie']);

    // Negative price/quota -> 400
    await request(app.getHttpServer())
      .post('/api/v1/platform-admin/plans')
      .set('Cookie', [`access_token=${adminCookies.access_token.value}`])
      .send({
        code: 'BAD_PLAN',
        name: 'Bad Plan',
        priceMonthly: -5,
        priceYearly: 100,
        maxProducts: 0,
        maxStaff: 0,
      })
      .expect(400);

    const planCode = `M2_TEMP_${Date.now()}`;
    const createRes = await request(app.getHttpServer())
      .post('/api/v1/platform-admin/plans')
      .set('Cookie', [`access_token=${adminCookies.access_token.value}`])
      .send({
        code: planCode,
        name: 'Plan M2 Temp',
        priceMonthly: 59,
        priceYearly: 590,
        maxProducts: 500,
        maxStaff: 2,
        isActive: true,
        sortOrder: 50,
      })
      .expect(201);
    cleanupPlanIds.push(createRes.body.id);

    // Duplicate code -> 409
    await request(app.getHttpServer())
      .post('/api/v1/platform-admin/plans')
      .set('Cookie', [`access_token=${adminCookies.access_token.value}`])
      .send({
        code: planCode,
        name: 'Dup Plan',
        priceMonthly: 59,
        priceYearly: 590,
        maxProducts: 500,
        maxStaff: 2,
      })
      .expect(409);

    // Deactivate -> disappears from public GET /plans
    await request(app.getHttpServer())
      .patch(`/api/v1/platform-admin/plans/${createRes.body.id}`)
      .set('Cookie', [`access_token=${adminCookies.access_token.value}`])
      .send({ isActive: false })
      .expect(200);

    const afterDeactivate = await request(app.getHttpServer()).get('/api/v1/plans').expect(200);
    expect(afterDeactivate.body.some((p: { code: string }) => p.code === planCode)).toBe(false);

    // PlanQuotaGuard live checks: electro-hogar is on EMPRENDEDOR (allowCustomDomain=false, maxStaff=1)
    await request(app.getHttpServer())
      .get('/api/v1/__m2-quota-probe/custom-domain')
      .set('x-tenant-slug', 'electro-hogar')
      .expect(403);

    await request(app.getHttpServer())
      .get('/api/v1/__m2-quota-probe/staff-quota')
      .set('x-tenant-slug', 'electro-hogar')
      .expect(403);

    // moda-mayorista is on CRECIMIENTO_PRO (allowCustomDomain=true, maxStaff=3 with 1 member)
    await request(app.getHttpServer())
      .get('/api/v1/__m2-quota-probe/custom-domain')
      .set('x-tenant-slug', 'moda-mayorista')
      .expect(200);

    await request(app.getHttpServer())
      .get('/api/v1/__m2-quota-probe/staff-quota')
      .set('x-tenant-slug', 'moda-mayorista')
      .expect(200);
  });

  it('F5 Tenants resolve (?slug=, headers, suspended 403), onboarding POST /tenants, current & theme update', async () => {
    const suffix = Date.now();

    // Resolve by ?slug=, x-tenant-host, and x-tenant-slug
    const byQuery = await request(app.getHttpServer())
      .get('/api/v1/tenants/resolve?slug=moda-mayorista')
      .expect(200);
    expect(byQuery.body.slug).toBe('moda-mayorista');
    expect(byQuery.body.theme.primaryColor).toBeDefined();

    await request(app.getHttpServer())
      .get('/api/v1/tenants/resolve')
      .set('x-tenant-host', 'electro-hogar.localhost:3000')
      .expect(200);

    await request(app.getHttpServer()).get('/api/v1/tenants/resolve').expect(404);
    await request(app.getHttpServer()).get('/api/v1/tenants/resolve?slug=admin').expect(404);

    const ownerLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/platform/login')
      .send({ email: 'carlos@urbanthreads.local', password: 'Owner1234!' })
      .expect(200);
    const owner1Cookies = extractCookiesMap(ownerLogin.headers['set-cookie']);

    // Reserved & malformed slugs -> 400; duplicate -> 409
    await request(app.getHttpServer())
      .post('/api/v1/tenants')
      .set('Cookie', [`access_token=${owner1Cookies.access_token.value}`])
      .send({ name: 'Reserved', slug: 'admin', planCode: 'EMPRENDEDOR' })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/v1/tenants')
      .set('Cookie', [`access_token=${owner1Cookies.access_token.value}`])
      .send({ name: 'Malformed', slug: 'Invalid Slug!', planCode: 'EMPRENDEDOR' })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/v1/tenants')
      .set('Cookie', [`access_token=${owner1Cookies.access_token.value}`])
      .send({ name: 'Duplicate', slug: 'moda-mayorista', planCode: 'EMPRENDEDOR' })
      .expect(409);

    const newSlug = `m2-store-${suffix}`;
    const createdRes = await request(app.getHttpServer())
      .post('/api/v1/tenants')
      .set('Cookie', [`access_token=${owner1Cookies.access_token.value}`])
      .send({
        name: 'M2 Store Onboarding',
        slug: newSlug,
        planCode: 'EMPRENDEDOR',
      })
      .expect(201);
    cleanupTenantIds.push(createdRes.body.id);

    expect(createdRes.body.status).toBe(TenantStatus.TRIAL);
    expect(createdRes.body.subscription?.id).toBeTruthy();
    expect(createdRes.body.theme?.primaryColor).toBeTruthy();

    // Suspended tenant returns 403 even via ?slug=
    await prisma.tenant.update({
      where: { id: createdRes.body.id },
      data: { status: TenantStatus.SUSPENDED },
    });
    await request(app.getHttpServer()).get(`/api/v1/tenants/resolve?slug=${newSlug}`).expect(403);

    // Restore to TRIAL, test theme update + cross-tenant 403 + invalid hex 400
    await prisma.tenant.update({
      where: { id: createdRes.body.id },
      data: { status: TenantStatus.TRIAL },
    });

    const currentWithoutHeader = await request(app.getHttpServer())
      .get('/api/v1/tenants/current')
      .set('Cookie', [`access_token=${owner1Cookies.access_token.value}`])
      .expect(200);
    expect(currentWithoutHeader.body.slug).toBe('moda-mayorista');

    const owner2Login = await request(app.getHttpServer())
      .post('/api/v1/auth/platform/login')
      .send({ email: 'lucia@electrohogar.local', password: 'Owner1234!' })
      .expect(200);
    const owner2Cookies = extractCookiesMap(owner2Login.headers['set-cookie']);

    // Cross-tenant owner targeting newSlug -> 403
    await request(app.getHttpServer())
      .patch('/api/v1/tenants/current/theme')
      .set('x-tenant-slug', newSlug)
      .set('Cookie', [`access_token=${owner2Cookies.access_token.value}`])
      .send({ primaryColor: '#FF0000' })
      .expect(403);

    // Invalid hex -> 400
    await request(app.getHttpServer())
      .patch('/api/v1/tenants/current/theme')
      .set('x-tenant-slug', newSlug)
      .set('Cookie', [`access_token=${owner1Cookies.access_token.value}`])
      .send({ primaryColor: 'not-a-hex' })
      .expect(400);

    // Valid theme update -> 200 + reflected immediately on resolve
    await request(app.getHttpServer())
      .patch('/api/v1/tenants/current/theme')
      .set('x-tenant-slug', newSlug)
      .set('Cookie', [`access_token=${owner1Cookies.access_token.value}`])
      .send({ accentColor: '#10B981', announcementText: 'Promo M2' })
      .expect(200);

    const resolvedUpdated = await request(app.getHttpServer())
      .get(`/api/v1/tenants/resolve?slug=${newSlug}`)
      .expect(200);
    expect(resolvedUpdated.body.theme.accentColor).toBe('#10B981');
    expect(resolvedUpdated.body.theme.announcementText).toBe('Promo M2');
  });

  it('F4 Concurrent refresh replay race revokes R_next deterministically for PLATFORM and CUSTOMER', async () => {
    // 1. PLATFORM concurrent refresh race (5 iterations)
    for (let iter = 0; iter < 5; iter += 1) {
      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/platform/login')
        .send({ email: 'carlos@urbanthreads.local', password: 'Owner1234!' })
        .expect(200);
      const r1 = extractCookiesMap(loginRes.headers['set-cookie']).refresh_token.value;
      const r1Hash = createHash('sha256').update(r1).digest('hex');
      const r1Row = await prisma.platformRefreshToken.findUnique({
        where: { tokenHash: r1Hash },
        select: { familyId: true },
      });
      expect(r1Row).toBeTruthy();

      const [resA, resB] = await Promise.all([
        request(app.getHttpServer())
          .post('/api/v1/auth/refresh')
          .set('Cookie', [`refresh_token=${r1}`]),
        request(app.getHttpServer())
          .post('/api/v1/auth/refresh')
          .set('Cookie', [`refresh_token=${r1}`]),
      ]);

      const statuses = [resA.status, resB.status].sort((a, b) => a - b);
      expect(statuses).toEqual([200, 401]);

      const unrevokedCount = await prisma.platformRefreshToken.count({
        where: { familyId: r1Row!.familyId, revokedAt: null },
      });
      expect(unrevokedCount).toBe(0);

      const winner = resA.status === 200 ? resA : resB;
      const rNext = extractCookiesMap(winner.headers['set-cookie']).refresh_token.value;
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', [`refresh_token=${rNext}`])
        .expect(401);
    }

    // 2. CUSTOMER concurrent refresh race (5 iterations)
    for (let iter = 0; iter < 5; iter += 1) {
      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/store/login')
        .set('x-tenant-slug', 'moda-mayorista')
        .send({ email: 'comprador@cliente.local', password: 'Buyer1234!' })
        .expect(200);
      const r1 = extractCookiesMap(loginRes.headers['set-cookie']).refresh_token.value;
      const r1Hash = createHash('sha256').update(r1).digest('hex');
      const r1Row = await prisma.customerRefreshToken.findUnique({
        where: { tokenHash: r1Hash },
        select: { familyId: true },
      });
      expect(r1Row).toBeTruthy();

      const [resA, resB] = await Promise.all([
        request(app.getHttpServer())
          .post('/api/v1/auth/refresh')
          .set('Cookie', [`refresh_token=${r1}`]),
        request(app.getHttpServer())
          .post('/api/v1/auth/refresh')
          .set('Cookie', [`refresh_token=${r1}`]),
      ]);

      const statuses = [resA.status, resB.status].sort((a, b) => a - b);
      expect(statuses).toEqual([200, 401]);

      const unrevokedCount = await prisma.customerRefreshToken.count({
        where: { familyId: r1Row!.familyId, revokedAt: null },
      });
      expect(unrevokedCount).toBe(0);

      const winner = resA.status === 200 ? resA : resB;
      const rNext = extractCookiesMap(winner.headers['set-cookie']).refresh_token.value;
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', [`refresh_token=${rNext}`])
        .expect(401);
    }
  });

  it('F4 GET /auth/me returns 403 TENANT_SUSPENDED for CUSTOMER of a suspended tenant', async () => {
    const suffix = Date.now();
    const ownerLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/platform/login')
      .send({ email: 'carlos@urbanthreads.local', password: 'Owner1234!' })
      .expect(200);
    const ownerAccess = extractCookiesMap(ownerLogin.headers['set-cookie']).access_token.value;

    const slug = `m2-cust-susp-${suffix}`;
    const tenantRes = await request(app.getHttpServer())
      .post('/api/v1/tenants')
      .set('Cookie', [`access_token=${ownerAccess}`])
      .send({ name: 'Cust Susp Store', slug, planCode: 'EMPRENDEDOR' })
      .expect(201);
    cleanupTenantIds.push(tenantRes.body.id);

    const custEmail = `m2-cust-susp-${suffix}@vendexa.local`;
    const custReg = await request(app.getHttpServer())
      .post('/api/v1/auth/store/register')
      .set('x-tenant-slug', slug)
      .send({ email: custEmail, password: 'BuyerSusp123!', fullName: 'Cust Susp' })
      .expect(201);
    cleanupCustomerIds.push(custReg.body.id);

    const mail = await waitForMailpitOtp(custEmail);
    await request(app.getHttpServer())
      .post('/api/v1/auth/store/verify-otp')
      .set('x-tenant-slug', slug)
      .send({ email: custEmail, otp: mail.otp })
      .expect(200);

    const custLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/store/login')
      .set('x-tenant-slug', slug)
      .send({ email: custEmail, password: 'BuyerSusp123!' })
      .expect(200);
    const custAccess = extractCookiesMap(custLogin.headers['set-cookie']).access_token.value;

    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', [`access_token=${custAccess}`])
      .expect(200);

    await prisma.tenant.update({
      where: { id: tenantRes.body.id },
      data: { status: TenantStatus.SUSPENDED },
    });

    const suspendedMe = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', [`access_token=${custAccess}`])
      .expect(403);
    expect(suspendedMe.body.code).toBe('TENANT_SUSPENDED');
  });
});
