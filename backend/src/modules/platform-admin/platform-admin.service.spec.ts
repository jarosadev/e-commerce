import { Test, TestingModule } from '@nestjs/testing';
import { PlatformAdminService } from './platform-admin.service';
import { PrismaService } from '../../database/prisma.service';
import { TenantResolutionService } from '../../common/services/tenant-resolution.service';
import { NotificationsService } from '../notifications/notifications.service';

describe('PlatformAdminService', () => {
  let service: PlatformAdminService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlatformAdminService,
        {
          provide: PrismaService,
          useValue: {
            tenant: { count: jest.fn() },
            platformUser: { count: jest.fn() },
            subscription: { count: jest.fn() },
            subscriptionPayment: { count: jest.fn(), aggregate: jest.fn() },
            order: { count: jest.fn() },
            storeCustomer: { count: jest.fn() },
          },
        },
        { provide: TenantResolutionService, useValue: { invalidateTenantCache: jest.fn() } },
        { provide: NotificationsService, useValue: { sendSubscriptionPaymentApproved: jest.fn() } },
      ],
    }).compile();

    service = module.get<PlatformAdminService>(PlatformAdminService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
    expect(prisma).toBeDefined();
  });

  it('should return overview data', async () => {
    (prisma.tenant.count as jest.Mock).mockResolvedValue(10);
    (prisma.platformUser.count as jest.Mock).mockResolvedValue(5);
    (prisma.subscription.count as jest.Mock).mockResolvedValue(2);
    (prisma.subscriptionPayment.count as jest.Mock).mockResolvedValue(1);
    (prisma.storeCustomer.count as jest.Mock).mockResolvedValue(20);
    (prisma.order.count as jest.Mock).mockResolvedValue(50);
    (prisma.subscriptionPayment.aggregate as jest.Mock).mockResolvedValue({
      _sum: { amount: 100 },
    });

    const result = await service.getOverview();
    expect(result.totalStores).toBe(10);
    expect(result.activeSubscriptions).toBe(2);
    expect(result.totalCollectedRevenue).toBe(100);
    expect(result.mrr).toBe(100);
  });
});
