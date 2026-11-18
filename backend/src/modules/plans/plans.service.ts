import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Plan, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { CreatePlanDto, PlanResponseDto, UpdatePlanDto } from './dto/plan.dto';

@Injectable()
export class PlansService {
  constructor(private readonly prisma: PrismaService) {}

  async listPublicPlans(): Promise<PlanResponseDto[]> {
    const plans = await this.prisma.plan.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { priceMonthly: 'asc' }],
    });
    return plans.map((plan) => this.serializePlan(plan));
  }

  async listAllPlans(): Promise<PlanResponseDto[]> {
    const plans = await this.prisma.plan.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return plans.map((plan) => this.serializePlan(plan));
  }

  async createPlan(dto: CreatePlanDto): Promise<PlanResponseDto> {
    const existing = await this.prisma.plan.findUnique({ where: { code: dto.code } });
    if (existing) {
      throw new ConflictException(`Ya existe un plan con el código ${dto.code}.`);
    }

    try {
      const created = await this.prisma.plan.create({
        data: {
          code: dto.code,
          name: dto.name,
          description: dto.description ?? null,
          priceMonthly: dto.priceMonthly,
          priceYearly: dto.priceYearly,
          currency: dto.currency ?? 'USD',
          maxProducts: dto.maxProducts,
          maxStaff: dto.maxStaff,
          allowCustomDomain: dto.allowCustomDomain ?? false,
          allowCsvImport: dto.allowCsvImport ?? false,
          allowAbandonedCart: dto.allowAbandonedCart ?? false,
          allowWholesale: dto.allowWholesale ?? true,
          allowCoupons: dto.allowCoupons ?? true,
          isActive: dto.isActive ?? true,
          sortOrder: dto.sortOrder ?? 0,
        },
      });
      return this.serializePlan(created);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(`Ya existe un plan con el código ${dto.code}.`);
      }
      throw error;
    }
  }

  async updatePlan(id: string, dto: UpdatePlanDto): Promise<PlanResponseDto> {
    const existing = await this.prisma.plan.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Plan no encontrado.');
    }

    if (dto.code && dto.code !== existing.code) {
      const conflict = await this.prisma.plan.findUnique({ where: { code: dto.code } });
      if (conflict) {
        throw new ConflictException(`Ya existe un plan con el código ${dto.code}.`);
      }
    }

    const updated = await this.prisma.plan.update({
      where: { id },
      data: {
        ...(dto.code !== undefined ? { code: dto.code } : {}),
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.priceMonthly !== undefined ? { priceMonthly: dto.priceMonthly } : {}),
        ...(dto.priceYearly !== undefined ? { priceYearly: dto.priceYearly } : {}),
        ...(dto.currency !== undefined ? { currency: dto.currency } : {}),
        ...(dto.maxProducts !== undefined ? { maxProducts: dto.maxProducts } : {}),
        ...(dto.maxStaff !== undefined ? { maxStaff: dto.maxStaff } : {}),
        ...(dto.allowCustomDomain !== undefined
          ? { allowCustomDomain: dto.allowCustomDomain }
          : {}),
        ...(dto.allowCsvImport !== undefined ? { allowCsvImport: dto.allowCsvImport } : {}),
        ...(dto.allowAbandonedCart !== undefined
          ? { allowAbandonedCart: dto.allowAbandonedCart }
          : {}),
        ...(dto.allowWholesale !== undefined ? { allowWholesale: dto.allowWholesale } : {}),
        ...(dto.allowCoupons !== undefined ? { allowCoupons: dto.allowCoupons } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      },
    });

    return this.serializePlan(updated);
  }

  serializePlan(plan: Plan): PlanResponseDto {
    return {
      id: plan.id,
      code: plan.code,
      name: plan.name,
      description: plan.description,
      priceMonthly: Number(plan.priceMonthly),
      priceYearly: Number(plan.priceYearly),
      currency: plan.currency,
      maxProducts: plan.maxProducts,
      maxStaff: plan.maxStaff,
      allowCustomDomain: plan.allowCustomDomain,
      allowCsvImport: plan.allowCsvImport,
      allowAbandonedCart: plan.allowAbandonedCart,
      allowWholesale: plan.allowWholesale,
      allowCoupons: plan.allowCoupons,
      isActive: plan.isActive,
      sortOrder: plan.sortOrder,
      createdAt: plan.createdAt.toISOString(),
      updatedAt: plan.updatedAt.toISOString(),
    };
  }
}
