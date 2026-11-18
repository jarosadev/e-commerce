import { ConflictException, NotFoundException } from '@nestjs/common';
import { Plan, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { PlansService } from './plans.service';

function makePlan(overrides: Partial<Plan> = {}): Plan {
  const now = new Date('2026-11-17T00:00:00.000Z');
  return {
    id: 'plan-1',
    code: 'EMPRENDEDOR',
    name: 'Plan Emprendedor',
    description: 'Plan inicial',
    priceMonthly: new Prisma.Decimal(19),
    priceYearly: new Prisma.Decimal(190),
    currency: 'USD',
    maxProducts: 100,
    maxStaff: 1,
    allowCustomDomain: false,
    allowCsvImport: false,
    allowAbandonedCart: false,
    allowWholesale: true,
    allowCoupons: true,
    isActive: true,
    sortOrder: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('PlansService', () => {
  let service: PlansService;
  let prisma: {
    plan: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };

  beforeEach(() => {
    prisma = {
      plan: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };
    service = new PlansService(prisma as unknown as PrismaService);
  });

  it('listPublicPlans filters isActive: true and serializes Decimals as numbers', async () => {
    prisma.plan.findMany.mockResolvedValue([makePlan()]);
    const result = await service.listPublicPlans();

    expect(prisma.plan.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { priceMonthly: 'asc' }],
    });
    expect(result).toHaveLength(1);
    expect(typeof result[0].priceMonthly).toBe('number');
    expect(result[0].priceMonthly).toBe(19);
    expect(result[0].priceYearly).toBe(190);
  });

  it('createPlan rejects duplicate code with 409 ConflictException', async () => {
    prisma.plan.findUnique.mockResolvedValue(makePlan());

    await expect(
      service.createPlan({
        code: 'EMPRENDEDOR',
        name: 'Dup',
        priceMonthly: 10,
        priceYearly: 100,
        maxProducts: 10,
        maxStaff: 1,
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('updatePlan throws 404 NotFoundException when plan id does not exist', async () => {
    prisma.plan.findUnique.mockResolvedValue(null);

    await expect(service.updatePlan('missing-id', { priceMonthly: 29 })).rejects.toThrow(
      NotFoundException,
    );
  });
});
