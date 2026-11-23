import { BadRequestException, ConflictException } from '@nestjs/common';
import { PlatformRole, Prisma, TenantStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { PlanQuotaService } from '../plans/plan-quota.service';
import { CatalogService } from './catalog.service';
import { StockAdjustmentMode } from './dto/catalog.dto';

describe('CatalogService', () => {
  let service: CatalogService;
  let tenantDb: {
    category: { findFirst: jest.Mock; create: jest.Mock; update: jest.Mock };
    product: { findFirst: jest.Mock };
    productVariant: { findMany: jest.Mock; findFirst: jest.Mock };
  };
  let prisma: {
    forTenant: jest.Mock;
    $transaction: jest.Mock;
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
      category: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
      product: { findFirst: jest.fn() },
      productVariant: { findMany: jest.fn(), findFirst: jest.fn() },
    };
    prisma = {
      forTenant: jest.fn().mockReturnValue(tenantDb),
      $transaction: jest.fn(),
    };

    service = new CatalogService(
      prisma as unknown as PrismaService,
      { assertFeature: jest.fn() } as unknown as PlanQuotaService,
    );
  });

  it('rejects self-parenting category update', async () => {
    tenantDb.category.findFirst.mockResolvedValue({ id: 'cat-1' });

    await expect(
      service.updateCategory(tenant, ownerUser, 'cat-1', { parentId: 'cat-1' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('generates Cartesian product variant matrix and skips existing SKUs', async () => {
    tenantDb.product.findFirst.mockResolvedValue({ id: 'prod-1' });
    tenantDb.productVariant.findMany.mockResolvedValue([{ sku: 'REM-S-NEGRO' }]);

    const createdRows: Array<Record<string, unknown>> = [];
    prisma.$transaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        productVariant: {
          create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
            const row = {
              id: `var-${createdRows.length + 1}`,
              ...data,
              retailPrice: new Prisma.Decimal(Number(data.retailPrice)),
              compareAtPrice: null,
              stockReserved: 0,
              isActive: true,
              createdAt: new Date(),
              updatedAt: new Date(),
            };
            createdRows.push(row);
            return Promise.resolve(row);
          }),
        },
      }),
    );

    const res = await service.generateVariantMatrix(tenant, ownerUser, 'prod-1', {
      skuPrefix: 'REM',
      axes: [
        { name: 'talla', values: ['S', 'M'] },
        { name: 'color', values: ['Negro', 'Blanco'] },
      ],
      retailPrice: 25,
      stockOnHand: 15,
    });

    expect(res.createdCount).toBe(3);
    expect(res.skippedCount).toBe(1);
    expect(res.variants.map((v) => v.sku)).toEqual(['REM-S-BLANCO', 'REM-M-NEGRO', 'REM-M-BLANCO']);
  });

  it('blocks atomic stock adjustment below stockReserved', async () => {
    prisma.$transaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        productVariant: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'var-1',
            tenantId: 'tenant-1',
            stockOnHand: 20,
            stockReserved: 8,
          }),
        },
      }),
    );

    await expect(
      service.adjustVariantStock(tenant, ownerUser, 'var-1', {
        mode: StockAdjustmentMode.SET,
        quantity: 5,
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects overlapping wholesale B2B tiers and open-ended tier before the last range', async () => {
    tenantDb.product.findFirst.mockResolvedValue({ id: 'prod-1' });

    await expect(
      service.replaceWholesaleTiers(tenant, ownerUser, 'prod-1', {
        tiers: [
          { minQuantity: 6, maxQuantity: 12, unitPrice: 30 },
          { minQuantity: 10, maxQuantity: 20, unitPrice: 25 },
        ],
      }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.replaceWholesaleTiers(tenant, ownerUser, 'prod-1', {
        tiers: [
          { minQuantity: 6, maxQuantity: null, unitPrice: 30 },
          { minQuantity: 12, maxQuantity: 24, unitPrice: 25 },
        ],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('computes low-stock alerts sorted by lowest available stock', async () => {
    tenantDb.productVariant.findMany.mockResolvedValue([
      {
        id: 'v-ok',
        productId: 'p-1',
        sku: 'OK-1',
        title: 'M',
        stockOnHand: 40,
        stockReserved: 2,
        lowStockThreshold: 5,
        product: { id: 'p-1', name: 'Hoodie', slug: 'hoodie' },
      },
      {
        id: 'v-low',
        productId: 'p-1',
        sku: 'LOW-1',
        title: 'S',
        stockOnHand: 7,
        stockReserved: 4,
        lowStockThreshold: 5,
        product: { id: 'p-1', name: 'Hoodie', slug: 'hoodie' },
      },
      {
        id: 'v-out',
        productId: 'p-1',
        sku: 'OUT-1',
        title: 'XL',
        stockOnHand: 3,
        stockReserved: 3,
        lowStockThreshold: 5,
        product: { id: 'p-1', name: 'Hoodie', slug: 'hoodie' },
      },
    ]);

    const res = await service.getLowStockAlerts(tenant, ownerUser);
    expect(res.totalAlerts).toBe(2);
    expect(res.outOfStockCount).toBe(1);
    expect(res.items[0].sku).toBe('OUT-1');
    expect(res.items[0].availableStock).toBe(0);
    expect(res.items[1].sku).toBe('LOW-1');
    expect(res.items[1].availableStock).toBe(3);
  });
});
