import { ExecutionContext, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SubscriptionStatus } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { AppClsStore } from '../../../common/cls/cls.types';
import {
  REQUIRE_PLAN_FEATURE_KEY,
  REQUIRE_PLAN_QUOTA_KEY,
} from '../../../common/decorators/require-plan.decorator';
import { PrismaService } from '../../../database/prisma.service';
import { PlanQuotaService } from '../plan-quota.service';
import { PlanQuotaGuard } from './plan-quota.guard';

function makeExecutionContext(req: Record<string, unknown>): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => req,
    }),
  } as unknown as ExecutionContext;
}

describe('PlanQuotaGuard & PlanQuotaService', () => {
  let reflector: { getAllAndOverride: jest.Mock };
  let tenantDb: {
    subscription: { findUnique: jest.Mock };
    product: { count: jest.Mock };
    tenantMember: { count: jest.Mock };
  };
  let prisma: { forTenant: jest.Mock };
  let cls: { isActive: jest.Mock; get: jest.Mock };
  let quotaService: PlanQuotaService;
  let guard: PlanQuotaGuard;

  const baseSubscription = {
    id: 'sub-1',
    tenantId: 'tenant-1',
    status: SubscriptionStatus.ACTIVE,
    gracePeriodEndsAt: null,
    plan: {
      id: 'plan-1',
      code: 'EMPRENDEDOR',
      name: 'Plan Emprendedor',
      maxProducts: 100,
      maxStaff: 1,
      allowCustomDomain: false,
      allowCsvImport: false,
      allowAbandonedCart: false,
      allowWholesale: true,
      allowCoupons: true,
    },
  };

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    tenantDb = {
      subscription: { findUnique: jest.fn().mockResolvedValue(baseSubscription) },
      product: { count: jest.fn().mockResolvedValue(10) },
      tenantMember: { count: jest.fn().mockResolvedValue(1) },
    };
    prisma = { forTenant: jest.fn(() => tenantDb) };
    cls = { isActive: jest.fn(() => false), get: jest.fn() };

    quotaService = new PlanQuotaService(prisma as unknown as PrismaService);
    guard = new PlanQuotaGuard(
      reflector as unknown as Reflector,
      quotaService,
      cls as unknown as ClsService<AppClsStore>,
    );
  });

  it('allows request when no quota or feature metadata is set', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    await expect(guard.canActivate(makeExecutionContext({}))).resolves.toBe(true);
  });

  it('throws 404 when quota is required but tenant is missing', async () => {
    reflector.getAllAndOverride.mockImplementation((key: string) =>
      key === REQUIRE_PLAN_QUOTA_KEY ? 'products' : undefined,
    );

    await expect(guard.canActivate(makeExecutionContext({}))).rejects.toThrow(NotFoundException);
  });

  it('allows under product quota and blocks when products >= maxProducts', async () => {
    reflector.getAllAndOverride.mockImplementation((key: string) =>
      key === REQUIRE_PLAN_QUOTA_KEY ? 'products' : undefined,
    );
    const ctx = makeExecutionContext({ tenantId: 'tenant-1' });

    tenantDb.product.count.mockResolvedValueOnce(99);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);

    tenantDb.product.count.mockResolvedValueOnce(100);
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('blocks when staff count >= maxStaff or feature flag is disabled', async () => {
    reflector.getAllAndOverride.mockImplementation((key: string) =>
      key === REQUIRE_PLAN_QUOTA_KEY ? 'staff' : undefined,
    );
    const ctx = makeExecutionContext({ tenant: { id: 'tenant-1' } });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);

    reflector.getAllAndOverride.mockImplementation((key: string) =>
      key === REQUIRE_PLAN_FEATURE_KEY ? 'allowCustomDomain' : undefined,
    );
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('blocks when subscription is CANCELED or SUSPENDED', async () => {
    reflector.getAllAndOverride.mockImplementation((key: string) =>
      key === REQUIRE_PLAN_FEATURE_KEY ? 'allowWholesale' : undefined,
    );
    tenantDb.subscription.findUnique.mockResolvedValueOnce({
      ...baseSubscription,
      status: SubscriptionStatus.SUSPENDED,
    });

    await expect(guard.canActivate(makeExecutionContext({ tenantId: 'tenant-1' }))).rejects.toThrow(
      ForbiddenException,
    );
  });
});
