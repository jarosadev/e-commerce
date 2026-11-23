import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BillingCycle,
  PaymentReviewStatus,
  PlatformRole,
  SubscriptionPaymentProvider,
  SubscriptionStatus,
  TenantStatus,
} from '@prisma/client';
import { createHmac } from 'crypto';
import { RequestWithContext } from '../../common/cls/cls.types';
import { TenantResolutionService } from '../../common/services/tenant-resolution.service';
import { EnvConfig } from '../../config/env.validation';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.module';
import { NotificationsService } from '../notifications/notifications.service';
import { SubscriptionsService } from './subscriptions.service';

describe('SubscriptionsService', () => {
  let service: SubscriptionsService;
  let prisma: {
    tenant: { findUnique: jest.Mock; findFirst: jest.Mock; update: jest.Mock };
    plan: { findFirst: jest.Mock; findMany: jest.Mock };
    product: { count: jest.Mock };
    tenantMember: { count: jest.Mock; findUnique: jest.Mock };
    subscription: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
    };
    subscriptionPayment: { findFirst: jest.Mock; create: jest.Mock };
    $transaction: jest.Mock;
  };
  let redis: { client: { set: jest.Mock } };
  let tenantResolution: { invalidateTenantCache: jest.Mock };
  let notifications: {
    sendSubscriptionPaymentApproved: jest.Mock;
    sendSubscriptionExpiringSoon: jest.Mock;
    sendSubscriptionGracePeriod: jest.Mock;
    sendSubscriptionSuspended: jest.Mock;
  };

  const makeConfig = (overrides: Partial<Record<keyof EnvConfig, unknown>> = {}) =>
    ({
      get: jest.fn((key: keyof EnvConfig) => {
        const defaults: Record<string, unknown> = {
          STRIPE_SECRET_KEY: '',
          STRIPE_WEBHOOK_SECRET: '',
          MERCADOPAGO_ACCESS_TOKEN: '',
          MERCADOPAGO_WEBHOOK_SECRET: '',
          SUBSCRIPTION_GRACE_DAYS: 5,
          SUBSCRIPTION_REMINDER_DAYS: 3,
          FRONTEND_URL: 'http://localhost:3000',
          ...overrides,
        };
        return defaults[key];
      }),
    }) as unknown as ConfigService<EnvConfig, true>;

  const ownerUser = {
    sub: 'owner-1',
    email: 'owner@test.local',
    actorType: 'PLATFORM' as const,
    role: PlatformRole.STORE_OWNER,
  };

  const mockReq = {} as RequestWithContext;

  const baseTenant = {
    id: 'tenant-1',
    slug: 'moda-mayorista',
    name: 'Urban Threads',
    ownerId: 'owner-1',
    status: TenantStatus.ACTIVE,
    contactEmail: 'ventas@urban.local',
    customDomains: [{ hostname: 'www.urban.local' }],
    owner: { id: 'owner-1', email: 'owner@test.local', fullName: 'Carlos Mendoza' },
    subscription: {
      id: 'sub-1',
      tenantId: 'tenant-1',
      planId: 'plan-pro',
      billingCycle: BillingCycle.MONTHLY,
      status: SubscriptionStatus.ACTIVE,
      currentPeriodStart: new Date('2026-11-01T00:00:00Z'),
      currentPeriodEnd: new Date('2026-12-01T00:00:00Z'),
      gracePeriodEndsAt: null,
      cancelAtPeriodEnd: false,
      plan: {
        id: 'plan-pro',
        code: 'CRECIMIENTO_PRO',
        name: 'Plan Crecimiento Pro',
        description: 'Pro',
        priceMonthly: 49,
        priceYearly: 490,
        currency: 'USD',
        maxProducts: 1500,
        maxStaff: 3,
        allowCustomDomain: true,
        allowCsvImport: true,
        allowAbandonedCart: true,
        allowWholesale: true,
        allowCoupons: true,
      },
      payments: [],
    },
  };

  beforeEach(() => {
    prisma = {
      tenant: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
      plan: { findFirst: jest.fn(), findMany: jest.fn() },
      product: { count: jest.fn() },
      tenantMember: { count: jest.fn(), findUnique: jest.fn() },
      subscription: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      subscriptionPayment: { findFirst: jest.fn(), create: jest.fn() },
      $transaction: jest.fn(),
    };
    redis = { client: { set: jest.fn().mockResolvedValue('OK') } };
    tenantResolution = { invalidateTenantCache: jest.fn().mockResolvedValue(undefined) };
    notifications = {
      sendSubscriptionPaymentApproved: jest.fn().mockResolvedValue('job-1'),
      sendSubscriptionExpiringSoon: jest.fn().mockResolvedValue('job-2'),
      sendSubscriptionGracePeriod: jest.fn().mockResolvedValue('job-3'),
      sendSubscriptionSuspended: jest.fn().mockResolvedValue('job-4'),
    };

    service = new SubscriptionsService(
      prisma as unknown as PrismaService,
      redis as unknown as RedisService,
      makeConfig(),
      tenantResolution as unknown as TenantResolutionService,
      notifications as unknown as NotificationsService,
    );
  });

  it('blocks plan downgrade when current products exceed target plan quota', async () => {
    prisma.tenant.findFirst.mockResolvedValue(baseTenant);
    prisma.plan.findFirst.mockResolvedValue({
      id: 'plan-starter',
      code: 'EMPRENDEDOR',
      name: 'Plan Emprendedor',
      maxProducts: 100,
      maxStaff: 1,
    });
    prisma.product.count.mockResolvedValue(140);
    prisma.tenantMember.count.mockResolvedValue(1);

    await expect(
      service.changePlan(mockReq, ownerUser, { planCode: 'EMPRENDEDOR' }),
    ).rejects.toThrow(ConflictException);
  });

  it('creates Stripe and MercadoPago sandbox checkout sessions cleanly when keys are absent', async () => {
    prisma.tenant.findFirst.mockResolvedValue(baseTenant);

    const stripeSession = await service.createStripeCheckoutSession(mockReq, ownerUser, {
      billingCycle: BillingCycle.YEARLY,
    });
    expect(stripeSession.provider).toBe('STRIPE');
    expect(stripeSession.mode).toBe('sandbox');
    expect(stripeSession.amount).toBe(490);
    expect(stripeSession.sessionId).toMatch(/^cs_sandbox_/);

    const mpSession = await service.createMercadoPagoCheckoutSession(mockReq, ownerUser, {
      billingCycle: BillingCycle.MONTHLY,
    });
    expect(mpSession.provider).toBe('MERCADOPAGO');
    expect(mpSession.mode).toBe('sandbox');
    expect(mpSession.amount).toBe(49);
    expect(mpSession.sessionId).toMatch(/^mp_sandbox_/);
  });

  it('enforces idempotency and verifies Stripe HMAC signature on webhooks', async () => {
    const secret = 'whsec_test_secret_12345';
    const signedService = new SubscriptionsService(
      prisma as unknown as PrismaService,
      redis as unknown as RedisService,
      makeConfig({ STRIPE_WEBHOOK_SECRET: secret }),
      tenantResolution as unknown as TenantResolutionService,
      notifications as unknown as NotificationsService,
    );

    const payload = {
      id: 'evt_stripe_001',
      type: 'invoice.payment_succeeded',
      data: {
        object: {
          amount_paid: 4900,
          currency: 'usd',
          subscription: 'sub_stripe_live_1',
          metadata: { tenantId: 'tenant-1', billingCycle: 'MONTHLY' },
        },
      },
    };

    // Invalid signature rejected
    await expect(signedService.handleStripeWebhook(payload, 't=123,v1=invalid')).rejects.toThrow(
      UnauthorizedException,
    );

    // Valid signature accepted & activates subscription
    const ts = '1730000000';
    const sig = createHmac('sha256', secret)
      .update(`${ts}.${JSON.stringify(payload)}`)
      .digest('hex');

    prisma.subscriptionPayment.findFirst.mockResolvedValueOnce(null);
    prisma.subscription.findUnique.mockResolvedValueOnce({
      ...baseTenant.subscription,
      tenant: baseTenant,
    });
    const txCreatePayment = jest.fn().mockResolvedValue({});
    const txUpdateSub = jest.fn().mockResolvedValue({});
    const txUpdateTenant = jest.fn().mockResolvedValue({});
    prisma.$transaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        subscriptionPayment: { create: txCreatePayment },
        subscription: { update: txUpdateSub },
        tenant: { update: txUpdateTenant },
      }),
    );

    const first = await signedService.handleStripeWebhook(payload, `t=${ts},v1=${sig}`);
    expect(first).toEqual({
      received: true,
      duplicate: false,
      provider: 'STRIPE',
      eventId: 'evt_stripe_001',
      actionTaken: 'subscription_activated',
    });
    expect(txCreatePayment).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          provider: SubscriptionPaymentProvider.STRIPE,
          reviewStatus: PaymentReviewStatus.APPROVED,
          amount: 49,
        }),
      }),
    );
    expect(notifications.sendSubscriptionPaymentApproved).toHaveBeenCalledTimes(1);

    // Duplicate delivery ignored
    prisma.subscriptionPayment.findFirst.mockResolvedValueOnce({ id: 'existing-pay' });
    const duplicate = await signedService.handleStripeWebhook(payload, `t=${ts},v1=${sig}`);
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.actionTaken).toBe('ignored_duplicate');
  });

  it('transitions expiring -> reminded, expired -> PAST_DUE grace, and expired grace -> SUSPENDED', async () => {
    const now = new Date('2026-12-10T12:00:00Z');
    const expiringSub = {
      ...baseTenant.subscription,
      id: 'sub-expiring',
      currentPeriodEnd: new Date('2026-12-12T12:00:00Z'),
      tenant: baseTenant,
    };
    const expiredSub = {
      ...baseTenant.subscription,
      id: 'sub-expired',
      currentPeriodEnd: new Date('2026-12-09T00:00:00Z'),
      cancelAtPeriodEnd: false,
      tenant: { ...baseTenant, id: 'tenant-2', slug: 'tienda-mora', name: 'Tienda Mora' },
    };
    const graceExpiredSub = {
      ...baseTenant.subscription,
      id: 'sub-grace-done',
      status: SubscriptionStatus.PAST_DUE,
      gracePeriodEndsAt: new Date('2026-12-08T00:00:00Z'),
      tenant: { ...baseTenant, id: 'tenant-3', slug: 'tienda-susp', name: 'Tienda Suspendida' },
    };

    prisma.subscription.findMany
      .mockResolvedValueOnce([expiringSub])
      .mockResolvedValueOnce([expiredSub])
      .mockResolvedValueOnce([graceExpiredSub]);

    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        subscription: { update: jest.fn().mockResolvedValue({}) },
        tenant: { update: jest.fn().mockResolvedValue({}) },
      }),
    );

    const result = await service.runSubscriptionLifecycleCheck(now);
    expect(result.remindedCount).toBe(1);
    expect(result.movedToGraceCount).toBe(1);
    expect(result.suspendedCount).toBe(1);
    expect(result.canceledAtPeriodEndCount).toBe(0);
    expect(notifications.sendSubscriptionExpiringSoon).toHaveBeenCalledTimes(1);
    expect(notifications.sendSubscriptionGracePeriod).toHaveBeenCalledTimes(1);
    expect(notifications.sendSubscriptionSuspended).toHaveBeenCalledTimes(1);
    expect(tenantResolution.invalidateTenantCache).toHaveBeenCalledTimes(2);
  });
});
