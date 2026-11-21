import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  BillingCycle,
  PaymentReviewStatus,
  SubscriptionStatus,
  TenantStatus,
} from '@prisma/client';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { RedisService } from '../src/redis/redis.module';

describe('Phase 2: Subscriptions, Webhooks, Lifecycle & SuperAdmin CRM (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let adminCookie: string[];
  let ownerCookie: string[];
  let createdTenantId: string;
  let createdTenantSlug: string;
  let createdOwnerId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
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

    // Login SuperAdmin
    const adminLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/platform/login')
      .send({ email: 'admin@vendexa.local', password: 'Admin1234!' })
      .expect(200);
    adminCookie = adminLogin.headers['set-cookie'] as unknown as string[];

    // Login seeded owner Carlos Mendoza
    const ownerLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/platform/login')
      .send({ email: 'carlos@urbanthreads.local', password: 'Owner1234!' })
      .expect(200);
    ownerCookie = ownerLogin.headers['set-cookie'] as unknown as string[];
    createdOwnerId = (ownerLogin.body as { user: { id: string } }).user.id;

    // Create an isolated test tenant for Phase 2 billing lifecycle testing
    createdTenantSlug = `phase2-test-${Date.now()}`;
    const createTenantRes = await request(app.getHttpServer())
      .post('/api/v1/tenants')
      .set('Cookie', ownerCookie)
      .send({
        name: 'Phase 2 Billing Test Store',
        slug: createdTenantSlug,
        planCode: 'EMPRENDEDOR',
        billingCycle: BillingCycle.MONTHLY,
      })
      .expect(201);
    createdTenantId = (createTenantRes.body as { id: string }).id;
  });

  afterAll(async () => {
    if (createdTenantId) {
      await prisma.tenant.deleteMany({ where: { id: createdTenantId } });
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
    await app.close();
  });

  it('checks real-time subdomain slug availability', async () => {
    const takenRes = await request(app.getHttpServer())
      .get('/api/v1/tenants/check-slug')
      .query({ slug: 'moda-mayorista' })
      .expect(200);
    expect(takenRes.body.available).toBe(false);

    const reservedRes = await request(app.getHttpServer())
      .get('/api/v1/tenants/check-slug')
      .query({ slug: 'admin' })
      .expect(200);
    expect(reservedRes.body.available).toBe(false);

    const freeRes = await request(app.getHttpServer())
      .get('/api/v1/tenants/check-slug')
      .query({ slug: `libre-${Date.now()}` })
      .expect(200);
    expect(freeRes.body.available).toBe(true);
  });

  it('returns subscription summary, quota usage, and supports plan change + sandbox Stripe/MP checkout', async () => {
    const currentRes = await request(app.getHttpServer())
      .get('/api/v1/subscriptions/current')
      .set('Cookie', ownerCookie)
      .set('x-tenant-slug', createdTenantSlug)
      .expect(200);

    expect(currentRes.body.tenantId).toBe(createdTenantId);
    expect(currentRes.body.plan.code).toBe('EMPRENDEDOR');
    expect(currentRes.body.usage.maxProducts).toBe(100);
    expect(currentRes.body.availablePlans.length).toBeGreaterThanOrEqual(3);

    // Upgrade to CRECIMIENTO_PRO
    const upgradeRes = await request(app.getHttpServer())
      .post('/api/v1/subscriptions/change-plan')
      .set('Cookie', ownerCookie)
      .set('x-tenant-slug', createdTenantSlug)
      .send({ planCode: 'CRECIMIENTO_PRO', billingCycle: BillingCycle.MONTHLY })
      .expect(200);
    expect(upgradeRes.body.plan.code).toBe('CRECIMIENTO_PRO');

    // Sandbox Stripe checkout
    const stripeRes = await request(app.getHttpServer())
      .post('/api/v1/subscriptions/checkout/stripe')
      .set('Cookie', ownerCookie)
      .set('x-tenant-slug', createdTenantSlug)
      .send({ billingCycle: BillingCycle.MONTHLY })
      .expect(201);
    expect(stripeRes.body.provider).toBe('STRIPE');
    expect(stripeRes.body.mode).toBe('sandbox');
    expect(stripeRes.body.amount).toBe(49);

    // Sandbox MercadoPago checkout
    const mpRes = await request(app.getHttpServer())
      .post('/api/v1/subscriptions/checkout/mercadopago')
      .set('Cookie', ownerCookie)
      .set('x-tenant-slug', createdTenantSlug)
      .send({ billingCycle: BillingCycle.YEARLY })
      .expect(201);
    expect(mpRes.body.provider).toBe('MERCADOPAGO');
    expect(mpRes.body.mode).toBe('sandbox');
    expect(mpRes.body.amount).toBe(490);
  });

  it('processes manual transfer submission, SuperAdmin rejection, re-submission, and SuperAdmin approval', async () => {
    const refReject = `TRF-REJ-${Date.now()}`;
    const submit1 = await request(app.getHttpServer())
      .post('/api/v1/subscriptions/manual-payments')
      .set('Cookie', ownerCookie)
      .set('x-tenant-slug', createdTenantSlug)
      .send({
        amount: 49,
        currency: 'USD',
        externalReference: refReject,
      })
      .expect(201);
    expect(submit1.body.reviewStatus).toBe(PaymentReviewStatus.PENDING);

    // Duplicate pending reference blocked
    await request(app.getHttpServer())
      .post('/api/v1/subscriptions/manual-payments')
      .set('Cookie', ownerCookie)
      .set('x-tenant-slug', createdTenantSlug)
      .send({
        amount: 49,
        currency: 'USD',
        externalReference: refReject,
      })
      .expect(409);

    // SuperAdmin rejects first payment with reason
    const rejectRes = await request(app.getHttpServer())
      .patch(`/api/v1/platform-admin/payments/${submit1.body.id}/review`)
      .set('Cookie', adminCookie)
      .send({
        reviewStatus: PaymentReviewStatus.REJECTED,
        note: 'Captura incompleta',
      })
      .expect(200);
    expect(rejectRes.body.reviewStatus).toBe(PaymentReviewStatus.REJECTED);

    // Owner submits valid transfer and SuperAdmin approves
    const refApprove = `TRF-OK-${Date.now()}`;
    const submit2 = await request(app.getHttpServer())
      .post('/api/v1/subscriptions/manual-payments')
      .set('Cookie', ownerCookie)
      .set('x-tenant-slug', createdTenantSlug)
      .send({
        amount: 49,
        currency: 'USD',
        externalReference: refApprove,
      })
      .expect(201);

    const approveRes = await request(app.getHttpServer())
      .patch(`/api/v1/platform-admin/payments/${submit2.body.id}/review`)
      .set('Cookie', adminCookie)
      .send({ reviewStatus: PaymentReviewStatus.APPROVED })
      .expect(200);
    expect(approveRes.body.reviewStatus).toBe(PaymentReviewStatus.APPROVED);

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: createdTenantId } });
    expect(tenant.status).toBe(TenantStatus.ACTIVE);
  });

  it('handles idempotent Stripe and MercadoPago webhooks without double-crediting', async () => {
    const stripeEventId = `evt_e2e_stripe_${Date.now()}`;
    const stripePayload = {
      id: stripeEventId,
      type: 'invoice.payment_succeeded',
      data: {
        object: {
          amount_paid: 4900,
          currency: 'usd',
          subscription: `sub_ext_${Date.now()}`,
          metadata: { tenantId: createdTenantId, billingCycle: BillingCycle.MONTHLY },
        },
      },
    };

    const first = await request(app.getHttpServer())
      .post('/api/v1/subscriptions/webhooks/stripe')
      .send(stripePayload)
      .expect(200);
    expect(first.body.duplicate).toBe(false);
    expect(first.body.actionTaken).toBe('subscription_activated');

    const second = await request(app.getHttpServer())
      .post('/api/v1/subscriptions/webhooks/stripe')
      .send(stripePayload)
      .expect(200);
    expect(second.body.duplicate).toBe(true);
    expect(second.body.actionTaken).toBe('ignored_duplicate');

    const mpEventId = `mp_e2e_${Date.now()}`;
    const mpPayload = {
      id: mpEventId,
      action: 'payment.approved',
      data: {
        tenantId: createdTenantId,
        amount: 49,
        currency: 'USD',
        billingCycle: BillingCycle.MONTHLY,
      },
    };

    const mpFirst = await request(app.getHttpServer())
      .post('/api/v1/subscriptions/webhooks/mercadopago')
      .send(mpPayload)
      .expect(200);
    expect(mpFirst.body.duplicate).toBe(false);
    expect(mpFirst.body.actionTaken).toBe('subscription_activated');

    await redis.del(`webhook:stripe:${stripeEventId}`);
    await redis.del(`webhook:mercadopago:${mpEventId}`);
  });

  it('runs automated lifecycle check: ACTIVE -> PAST_DUE (grace) -> SUSPENDED (blocks storefront) -> reactivated', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // 1. Expire currentPeriodEnd -> lifecycle moves to PAST_DUE with grace period
    await prisma.subscription.update({
      where: { tenantId: createdTenantId },
      data: {
        status: SubscriptionStatus.ACTIVE,
        currentPeriodEnd: yesterday,
        gracePeriodEndsAt: null,
      },
    });

    const graceRun = await request(app.getHttpServer())
      .post('/api/v1/platform-admin/subscriptions/run-lifecycle-check')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(graceRun.body.movedToGraceCount).toBeGreaterThanOrEqual(1);

    const subAfterGrace = await prisma.subscription.findUniqueOrThrow({
      where: { tenantId: createdTenantId },
    });
    expect(subAfterGrace.status).toBe(SubscriptionStatus.PAST_DUE);
    expect(subAfterGrace.gracePeriodEndsAt).not.toBeNull();

    // 2. Expire gracePeriodEndsAt -> lifecycle auto-suspends tenant & blocks public storefront
    await prisma.subscription.update({
      where: { tenantId: createdTenantId },
      data: { gracePeriodEndsAt: yesterday },
    });

    const suspendRun = await request(app.getHttpServer())
      .post('/api/v1/platform-admin/subscriptions/run-lifecycle-check')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(suspendRun.body.suspendedCount).toBeGreaterThanOrEqual(1);

    // Storefront is blocked (403 TENANT_SUSPENDED)
    await request(app.getHttpServer())
      .get('/api/v1/storefront/products')
      .set('x-tenant-slug', createdTenantSlug)
      .expect(403);

    // Owner can STILL access /subscriptions/current to pay and reactivate!
    const billingWhileSuspended = await request(app.getHttpServer())
      .get('/api/v1/subscriptions/current')
      .set('Cookie', ownerCookie)
      .set('x-tenant-slug', createdTenantSlug)
      .expect(200);
    expect(billingWhileSuspended.body.tenantStatus).toBe(TenantStatus.SUSPENDED);
  });

  it('supports SuperAdmin CRM filters, overview MRR KPIs, and timestamped client notes', async () => {
    const overview = await request(app.getHttpServer())
      .get('/api/v1/platform-admin/overview')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(typeof overview.body.mrr).toBe('number');
    expect(typeof overview.body.storesAtRisk).toBe('number');

    const filtered = await request(app.getHttpServer())
      .get('/api/v1/platform-admin/clients')
      .set('Cookie', adminCookie)
      .query({ tenantStatus: TenantStatus.ACTIVE, planCode: 'CRECIMIENTO_PRO' })
      .expect(200);
    expect(filtered.body.items.length).toBeGreaterThanOrEqual(1);
    expect(filtered.body.items[0].ownedTenants[0].usage).toBeDefined();

    const noteMarker = `Seguimiento Fase 2 ${Date.now()}`;
    const noteRes = await request(app.getHttpServer())
      .post(`/api/v1/platform-admin/clients/${createdOwnerId}/notes`)
      .set('Cookie', adminCookie)
      .send({ note: noteMarker })
      .expect(200);
    expect(noteRes.body.ownerProfile.internalAdminNotes).toContain(noteMarker);
  });
});
