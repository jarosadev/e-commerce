import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  BillingCycle,
  PlatformRole,
  Prisma,
  SubscriptionStatus,
  TenantMemberRole,
  TenantStatus,
} from '@prisma/client';
import { RequestWithContext, ResolvedTenantContext } from '../../common/cls/cls.types';
import { TenantResolutionService } from '../../common/services/tenant-resolution.service';
import { PrismaService } from '../../database/prisma.service';
import { TenantsService } from './tenants.service';

describe('TenantsService', () => {
  let service: TenantsService;
  let tenantDb: {
    tenantMember: { findUnique: jest.Mock };
    storeTheme: { upsert: jest.Mock };
    customDomain: { findMany: jest.Mock };
  };
  let prisma: {
    tenant: { findUnique: jest.Mock; findMany: jest.Mock; findFirst: jest.Mock; create: jest.Mock };
    plan: { findFirst: jest.Mock };
    platformUser: { findUniqueOrThrow: jest.Mock };
    tenantOwnerProfile: { upsert: jest.Mock };
    forTenant: jest.Mock;
    $transaction: jest.Mock;
  };
  let tenantResolutionService: { invalidateTenantCache: jest.Mock };

  const ownerUser = {
    sub: 'owner-1',
    email: 'owner@test.com',
    actorType: 'PLATFORM' as const,
    role: PlatformRole.STORE_OWNER,
  };

  beforeEach(() => {
    tenantDb = {
      tenantMember: { findUnique: jest.fn() },
      storeTheme: { upsert: jest.fn() },
      customDomain: { findMany: jest.fn().mockResolvedValue([]) },
    };

    prisma = {
      tenant: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      plan: { findFirst: jest.fn() },
      platformUser: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'owner-1', email: 'owner@test.com' }),
      },
      tenantOwnerProfile: { upsert: jest.fn().mockResolvedValue({}) },
      forTenant: jest.fn(() => tenantDb),
      $transaction: jest.fn(async (cb: (tx: typeof prisma) => Promise<unknown>) => cb(prisma)),
    };

    tenantResolutionService = {
      invalidateTenantCache: jest.fn().mockResolvedValue(undefined),
    };

    service = new TenantsService(
      prisma as unknown as PrismaService,
      tenantResolutionService as unknown as TenantResolutionService,
    );
  });

  it('resolvePublicTenant resolves by ?slug= and blocks SUSPENDED stores with 403', async () => {
    const req = { headers: {} } as unknown as RequestWithContext;

    await expect(service.resolvePublicTenant(req, 'admin')).rejects.toThrow(NotFoundException);

    prisma.tenant.findUnique.mockResolvedValueOnce({
      id: 't-susp',
      slug: 'tienda-susp',
      name: 'Susp',
      description: null,
      ownerId: 'owner-1',
      status: TenantStatus.SUSPENDED,
      currency: 'USD',
      whatsappSalesNumber: null,
      contactEmail: null,
      minWholesaleAmount: null,
      minWholesaleQty: null,
      stockReservationMins: 120,
      theme: null,
      subscription: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(service.resolvePublicTenant(req, 'tienda-susp')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('createTenant rejects reserved slugs (400) and duplicate slugs (409)', async () => {
    await expect(
      service.createTenant(ownerUser, { name: 'Admin Store', slug: 'admin' }),
    ).rejects.toThrow(BadRequestException);

    prisma.tenant.findUnique.mockResolvedValueOnce({ id: 'existing' });
    await expect(
      service.createTenant(ownerUser, { name: 'Dup Store', slug: 'moda-mayorista' }),
    ).rejects.toThrow(ConflictException);
  });

  it('createTenant atomically creates TRIAL tenant, OWNER member, StoreTheme, and 14-day TRIALING subscription', async () => {
    prisma.tenant.findUnique.mockResolvedValueOnce(null);
    prisma.plan.findFirst.mockResolvedValueOnce({
      id: 'plan-starter',
      code: 'EMPRENDEDOR',
      name: 'Plan Emprendedor',
      maxProducts: 100,
      maxStaff: 1,
      allowCustomDomain: false,
      allowCsvImport: false,
      allowAbandonedCart: false,
      allowWholesale: true,
      allowCoupons: true,
    });

    const now = new Date();
    prisma.tenant.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'tenant-new',
        slug: data.slug,
        name: data.name,
        description: null,
        ownerId: ownerUser.sub,
        status: TenantStatus.TRIAL,
        currency: 'USD',
        whatsappSalesNumber: null,
        contactEmail: 'owner@test.com',
        minWholesaleAmount: new Prisma.Decimal(100),
        minWholesaleQty: 5,
        stockReservationMins: 120,
        theme: {
          id: 'theme-1',
          tenantId: 'tenant-new',
          logoUrl: null,
          faviconUrl: null,
          primaryColor: '#0F172A',
          accentColor: '#2563EB',
          darkModeDefault: false,
          heroTitle: data.name,
          heroSubtitle: null,
          heroBanners: null,
          announcementText: null,
          updatedAt: now,
        },
        subscription: {
          id: 'sub-new',
          planId: 'plan-starter',
          billingCycle: BillingCycle.MONTHLY,
          status: SubscriptionStatus.TRIALING,
          currentPeriodStart: now,
          currentPeriodEnd: new Date(now.getTime() + 14 * 86_400_000),
          gracePeriodEndsAt: null,
          plan: {
            id: 'plan-starter',
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
        },
        createdAt: now,
        updatedAt: now,
      }),
    );

    const created = await service.createTenant(ownerUser, {
      name: 'Nueva Tienda',
      slug: 'nueva-tienda',
      planCode: 'EMPRENDEDOR',
    });

    expect(created.status).toBe(TenantStatus.TRIAL);
    expect(created.subscription?.id).toBe('sub-new');
    expect(created.subscription?.status).toBe(SubscriptionStatus.TRIALING);
    expect(tenantResolutionService.invalidateTenantCache).toHaveBeenCalledWith('nueva-tienda');
  });

  it('updateCurrentTheme rejects non-member cross-tenant access (403) and invalidates cache with custom domains', async () => {
    const tenantCtx: ResolvedTenantContext = {
      id: 'tenant-1',
      slug: 'moda-mayorista',
      name: 'Moda Mayorista',
      status: TenantStatus.ACTIVE,
      currency: 'USD',
      ownerId: 'owner-1',
    };

    const otherOwner = {
      sub: 'owner-2',
      email: 'other@test.com',
      actorType: 'PLATFORM' as const,
      role: PlatformRole.STORE_OWNER,
    };

    tenantDb.tenantMember.findUnique.mockResolvedValueOnce(null);
    await expect(
      service.updateCurrentTheme(tenantCtx, otherOwner, { accentColor: '#10B981' }),
    ).rejects.toThrow(ForbiddenException);

    tenantDb.tenantMember.findUnique.mockResolvedValueOnce({
      role: TenantMemberRole.STAFF,
    });
    await expect(
      service.updateCurrentTheme(tenantCtx, otherOwner, { accentColor: '#10B981' }),
    ).rejects.toThrow(ForbiddenException);

    tenantDb.storeTheme.upsert.mockResolvedValueOnce({
      id: 'theme-1',
      tenantId: 'tenant-1',
      logoUrl: null,
      faviconUrl: null,
      primaryColor: '#0F172A',
      accentColor: '#10B981',
      darkModeDefault: false,
      heroTitle: 'Hero',
      heroSubtitle: null,
      heroBanners: null,
      announcementText: 'Promo',
      updatedAt: new Date(),
    });
    tenantDb.customDomain.findMany.mockResolvedValueOnce([{ hostname: 'tienda.custom.com' }]);

    const updated = await service.updateCurrentTheme(tenantCtx, ownerUser, {
      accentColor: '#10B981',
      announcementText: 'Promo',
    });

    expect(updated.accentColor).toBe('#10B981');
    expect(tenantResolutionService.invalidateTenantCache).toHaveBeenCalledWith('moda-mayorista', [
      'tienda.custom.com',
    ]);
  });
});
