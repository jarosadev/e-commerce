import { Test, TestingModule } from '@nestjs/testing';
import { BillingCycle, PaymentReviewStatus, PlatformRole, TenantStatus } from '@prisma/client';
import { TenantResolutionService } from '../../common/services/tenant-resolution.service';
import { PrismaService } from '../../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PlatformAdminService } from './platform-admin.service';

describe('PlatformAdminService', () => {
  let service: PlatformAdminService;
  let prisma: {
    tenant: { count: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
    platformUser: { count: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock };
    tenantOwnerProfile: { upsert: jest.Mock };
    subscription: { count: jest.Mock; findMany: jest.Mock };
    subscriptionPayment: { count: jest.Mock; aggregate: jest.Mock };
    order: { count: jest.Mock };
    storeCustomer: { count: jest.Mock };
    $transaction: jest.Mock;
  };
  let notifications: {
    sendSubscriptionPaymentApproved: jest.Mock;
    sendSubscriptionPaymentRejected: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      tenant: { count: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
      platformUser: { count: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
      tenantOwnerProfile: { upsert: jest.fn() },
      subscription: { count: jest.fn(), findMany: jest.fn() },
      subscriptionPayment: { count: jest.fn(), aggregate: jest.fn() },
      order: { count: jest.fn() },
      storeCustomer: { count: jest.fn() },
      $transaction: jest.fn(),
    };
    notifications = {
      sendSubscriptionPaymentApproved: jest.fn(),
      sendSubscriptionPaymentRejected: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlatformAdminService,
        { provide: PrismaService, useValue: prisma },
        { provide: TenantResolutionService, useValue: { invalidateTenantCache: jest.fn() } },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();

    service = module.get<PlatformAdminService>(PlatformAdminService);
  });

  it('returns normalized SaaS MRR and overview KPIs', async () => {
    prisma.tenant.count.mockResolvedValue(10);
    prisma.platformUser.count.mockResolvedValue(5);
    prisma.subscription.count.mockResolvedValue(2);
    prisma.subscription.findMany.mockResolvedValue([
      {
        billingCycle: BillingCycle.MONTHLY,
        plan: { priceMonthly: 49, priceYearly: 490 },
      },
      {
        billingCycle: BillingCycle.YEARLY,
        plan: { priceMonthly: 99, priceYearly: 990 },
      },
    ]);
    prisma.subscriptionPayment.count.mockResolvedValue(1);
    prisma.storeCustomer.count.mockResolvedValue(20);
    prisma.order.count.mockResolvedValue(50);
    prisma.subscriptionPayment.aggregate.mockResolvedValue({
      _sum: { amount: 250 },
    });

    const result = await service.getOverview();
    expect(result.totalStores).toBe(10);
    expect(result.activeSubscriptions).toBe(2);
    expect(result.totalCollectedRevenue).toBe(250);
    // 49 + (990 / 12) = 49 + 82.5 = 131.5
    expect(result.mrr).toBe(131.5);
  });

  it('applies tenantStatus, planCode and search filters and computes store quota usage', async () => {
    prisma.platformUser.findMany.mockResolvedValue([
      {
        id: 'owner-1',
        email: 'carlos@test.local',
        fullName: 'Carlos',
        role: PlatformRole.STORE_OWNER,
        ownerProfile: { legalName: 'Urban SRL', taxId: '20-123' },
        ownedTenants: [
          {
            id: 'tenant-1',
            slug: 'moda',
            name: 'Moda',
            status: TenantStatus.ACTIVE,
            subscription: {
              plan: { code: 'CRECIMIENTO_PRO', maxProducts: 100, maxStaff: 3 },
              payments: [],
            },
            _count: { products: 25, members: 1, orders: 4, customers: 10 },
          },
        ],
      },
    ]);
    prisma.platformUser.count.mockResolvedValue(1);

    const res = await service.listClients({
      search: 'urban',
      tenantStatus: TenantStatus.ACTIVE,
      planCode: 'crecimiento_pro',
      page: 1,
      limit: 10,
    });

    expect(prisma.platformUser.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: expect.arrayContaining([
            expect.objectContaining({
              ownedTenants: {
                some: {
                  status: TenantStatus.ACTIVE,
                  subscription: { plan: { code: 'CRECIMIENTO_PRO' } },
                },
              },
            }),
          ]),
        },
      }),
    );
    expect(res.items[0].ownedTenants[0].usage).toEqual({
      productsUsed: 25,
      maxProducts: 100,
      productsUsagePercent: 25,
      staffUsed: 1,
      maxStaff: 3,
      staffUsagePercent: 33,
    });
  });

  it('appends timestamped CRM internal note to ownerProfile', async () => {
    prisma.platformUser.findUnique
      .mockResolvedValueOnce({
        id: 'owner-1',
        ownerProfile: { internalAdminNotes: 'Nota inicial' },
      })
      .mockResolvedValueOnce({
        id: 'owner-1',
        email: 'carlos@test.local',
        fullName: 'Carlos',
        ownerProfile: { internalAdminNotes: 'Nota inicial\n[2026-11-21] Nueva nota' },
        ownedTenants: [],
      });

    await service.appendClientNote(
      'owner-1',
      {
        sub: 'admin-1',
        email: 'admin@vendexa.local',
        role: PlatformRole.SUPER_ADMIN,
        actorType: 'PLATFORM',
      },
      'Llamada realizada',
    );

    expect(prisma.tenantOwnerProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'owner-1' },
        update: {
          internalAdminNotes: expect.stringContaining('admin@vendexa.local] Llamada realizada'),
        },
      }),
    );
  });

  it('sends rejection email when SuperAdmin rejects a manual subscription payment', async () => {
    const paymentRecord = {
      id: 'pay-1',
      subscriptionId: 'sub-1',
      amount: 49,
      currency: 'USD',
      externalReference: 'TRF-555',
      reviewStatus: PaymentReviewStatus.PENDING,
      subscription: {
        id: 'sub-1',
        tenantId: 'tenant-1',
        billingCycle: BillingCycle.MONTHLY,
        plan: { name: 'Plan Crecimiento Pro' },
        tenant: {
          id: 'tenant-1',
          slug: 'moda',
          name: 'Urban Threads',
          contactEmail: null,
          customDomains: [],
          owner: { id: 'owner-1', email: 'carlos@test.local', fullName: 'Carlos Mendoza' },
        },
      },
    };

    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        subscriptionPayment: {
          findUnique: jest.fn().mockResolvedValue(paymentRecord),
          update: jest.fn().mockResolvedValue({
            ...paymentRecord,
            reviewStatus: PaymentReviewStatus.REJECTED,
          }),
        },
      }),
    );

    await service.reviewPayment(
      'pay-1',
      {
        sub: 'admin-1',
        email: 'admin@vendexa.local',
        role: PlatformRole.SUPER_ADMIN,
        actorType: 'PLATFORM',
      },
      PaymentReviewStatus.REJECTED,
      'Referencia no encontrada en banco',
    );

    expect(notifications.sendSubscriptionPaymentRejected).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'carlos@test.local',
        ownerName: 'Carlos Mendoza',
        reason: 'Referencia no encontrada en banco',
      }),
    );
  });
});
