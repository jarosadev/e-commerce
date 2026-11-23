import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { CustomerTier, PlatformRole, Prisma, TenantStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { StoreOpsService } from './store-ops.service';

describe('StoreOpsService', () => {
  let service: StoreOpsService;
  let tenantDb: {
    shippingZone: { create: jest.Mock; findMany: jest.Mock };
    storeCustomer: { findFirst: jest.Mock; update: jest.Mock };
    tenantMember: { findUnique: jest.Mock };
  };

  const tenant = {
    id: 'tenant-1',
    slug: 'moda-mayorista',
    name: 'Urban Threads',
    status: TenantStatus.ACTIVE,
    currency: 'USD',
    ownerId: 'owner-1',
  };

  const ownerUser = {
    sub: 'owner-1',
    email: 'owner@test.local',
    actorType: 'PLATFORM' as const,
    role: PlatformRole.STORE_OWNER,
  };

  beforeEach(() => {
    tenantDb = {
      shippingZone: { create: jest.fn(), findMany: jest.fn() },
      storeCustomer: { findFirst: jest.fn(), update: jest.fn() },
      tenantMember: { findUnique: jest.fn() },
    };

    service = new StoreOpsService({
      forTenant: jest.fn().mockReturnValue(tenantDb),
    } as unknown as PrismaService);
  });

  it('forces flatRate = 0 for local pickup shipping zones', async () => {
    tenantDb.shippingZone.create.mockResolvedValue({
      id: 'zone-1',
      name: 'Retiro Showroom',
      cities: ['CABA'],
      flatRate: new Prisma.Decimal(0),
      freeShippingThreshold: null,
      isLocalPickup: true,
      pickupAddress: 'Av. Principal 123',
      estimatedDays: '2 horas',
      isActive: true,
    });

    const result = await service.createShippingZone(tenant, ownerUser, {
      name: 'Retiro Showroom',
      cities: [' CABA '],
      flatRate: 15,
      isLocalPickup: true,
      pickupAddress: 'Av. Principal 123',
    });

    expect(tenantDb.shippingZone.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          flatRate: 0,
          cities: ['CABA'],
        }),
      }),
    );
    expect(result.flatRate).toBe(0);
  });

  it('blocks unauthorized users from accessing another tenant store-ops', async () => {
    tenantDb.tenantMember.findUnique.mockResolvedValue(null);

    await expect(
      service.listShippingZones(tenant, {
        sub: 'intruder-2',
        email: 'other@test.local',
        actorType: 'PLATFORM',
        role: PlatformRole.STORE_OWNER,
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('throws NotFoundException when promoting a customer that does not belong to the tenant', async () => {
    tenantDb.storeCustomer.findFirst.mockResolvedValue(null);

    await expect(
      service.updateStoreCustomerTier(tenant, ownerUser, 'cust-unknown', {
        customerTier: CustomerTier.WHOLESALE_B2B,
      }),
    ).rejects.toThrow(NotFoundException);
  });
});
