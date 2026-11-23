import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PlatformRole, Prisma, TenantMemberRole } from '@prisma/client';
import { AuthenticatedUserContext, ResolvedTenantContext } from '../../common/cls/cls.types';
import { PrismaService } from '../../database/prisma.service';
import {
  CreatePaymentMethodDto,
  CreateShippingZoneDto,
  ListStoreCustomersQueryDto,
  UpdatePaymentMethodDto,
  UpdateShippingZoneDto,
  UpdateStoreCustomerTierDto,
} from './dto/store-ops.dto';

@Injectable()
export class StoreOpsService {
  constructor(private readonly prisma: PrismaService) {}

  // ============================================================================
  // MANUAL PAYMENT METHODS
  // ============================================================================

  async listPaymentMethods(tenant: ResolvedTenantContext, user: AuthenticatedUserContext) {
    await this.assertTenantAccess(tenant, user, [
      TenantMemberRole.OWNER,
      TenantMemberRole.ADMIN,
      TenantMemberRole.STAFF,
    ]);

    return this.prisma.forTenant(tenant.id).storePaymentMethod.findMany({
      orderBy: [{ isActive: 'desc' }, { title: 'asc' }],
    });
  }

  async createPaymentMethod(
    tenant: ResolvedTenantContext,
    user: AuthenticatedUserContext,
    dto: CreatePaymentMethodDto,
  ) {
    await this.assertTenantAccess(tenant, user, [TenantMemberRole.OWNER, TenantMemberRole.ADMIN]);

    return this.prisma.forTenant(tenant.id).storePaymentMethod.create({
      data: {
        tenantId: tenant.id,
        type: dto.type,
        title: dto.title,
        instructions: dto.instructions ?? null,
        accountDetailsJson:
          dto.accountDetailsJson === undefined || dto.accountDetailsJson === null
            ? Prisma.JsonNull
            : (dto.accountDetailsJson as Prisma.InputJsonValue),
        qrImageUrl: dto.qrImageUrl ?? null,
        requiresReceipt: dto.requiresReceipt ?? true,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async updatePaymentMethod(
    tenant: ResolvedTenantContext,
    user: AuthenticatedUserContext,
    methodId: string,
    dto: UpdatePaymentMethodDto,
  ) {
    await this.assertTenantAccess(tenant, user, [TenantMemberRole.OWNER, TenantMemberRole.ADMIN]);
    const db = this.prisma.forTenant(tenant.id);

    const existing = await db.storePaymentMethod.findFirst({ where: { id: methodId } });
    if (!existing) {
      throw new NotFoundException('Método de pago no encontrado en esta tienda.');
    }

    return db.storePaymentMethod.update({
      where: { id: methodId },
      data: {
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.instructions !== undefined ? { instructions: dto.instructions } : {}),
        ...(dto.accountDetailsJson !== undefined
          ? {
              accountDetailsJson:
                dto.accountDetailsJson === null
                  ? Prisma.JsonNull
                  : (dto.accountDetailsJson as Prisma.InputJsonValue),
            }
          : {}),
        ...(dto.qrImageUrl !== undefined ? { qrImageUrl: dto.qrImageUrl } : {}),
        ...(dto.requiresReceipt !== undefined ? { requiresReceipt: dto.requiresReceipt } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
  }

  async deletePaymentMethod(
    tenant: ResolvedTenantContext,
    user: AuthenticatedUserContext,
    methodId: string,
  ) {
    await this.assertTenantAccess(tenant, user, [TenantMemberRole.OWNER, TenantMemberRole.ADMIN]);
    const db = this.prisma.forTenant(tenant.id);

    const existing = await db.storePaymentMethod.findFirst({ where: { id: methodId } });
    if (!existing) {
      throw new NotFoundException('Método de pago no encontrado en esta tienda.');
    }

    await db.storePaymentMethod.delete({ where: { id: methodId } });
    return { deleted: true, id: methodId };
  }

  // ============================================================================
  // SHIPPING ZONES & LOCAL PICKUP
  // ============================================================================

  async listShippingZones(tenant: ResolvedTenantContext, user: AuthenticatedUserContext) {
    await this.assertTenantAccess(tenant, user, [
      TenantMemberRole.OWNER,
      TenantMemberRole.ADMIN,
      TenantMemberRole.STAFF,
    ]);

    const zones = await this.prisma.forTenant(tenant.id).shippingZone.findMany({
      orderBy: [{ isLocalPickup: 'desc' }, { name: 'asc' }],
    });

    return zones.map((z) => ({
      ...z,
      flatRate: Number(z.flatRate),
      freeShippingThreshold:
        z.freeShippingThreshold !== null ? Number(z.freeShippingThreshold) : null,
    }));
  }

  async createShippingZone(
    tenant: ResolvedTenantContext,
    user: AuthenticatedUserContext,
    dto: CreateShippingZoneDto,
  ) {
    await this.assertTenantAccess(tenant, user, [TenantMemberRole.OWNER, TenantMemberRole.ADMIN]);

    const created = await this.prisma.forTenant(tenant.id).shippingZone.create({
      data: {
        tenantId: tenant.id,
        name: dto.name,
        cities: dto.cities.map((c) => c.trim()).filter(Boolean),
        flatRate: dto.isLocalPickup ? 0 : dto.flatRate,
        freeShippingThreshold: dto.freeShippingThreshold ?? null,
        isLocalPickup: dto.isLocalPickup ?? false,
        pickupAddress: dto.pickupAddress ?? null,
        estimatedDays: dto.estimatedDays ?? null,
        isActive: dto.isActive ?? true,
      },
    });

    return {
      ...created,
      flatRate: Number(created.flatRate),
      freeShippingThreshold:
        created.freeShippingThreshold !== null ? Number(created.freeShippingThreshold) : null,
    };
  }

  async updateShippingZone(
    tenant: ResolvedTenantContext,
    user: AuthenticatedUserContext,
    zoneId: string,
    dto: UpdateShippingZoneDto,
  ) {
    await this.assertTenantAccess(tenant, user, [TenantMemberRole.OWNER, TenantMemberRole.ADMIN]);
    const db = this.prisma.forTenant(tenant.id);

    const existing = await db.shippingZone.findFirst({ where: { id: zoneId } });
    if (!existing) {
      throw new NotFoundException('Zona de envío no encontrada en esta tienda.');
    }

    const updated = await db.shippingZone.update({
      where: { id: zoneId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.cities !== undefined
          ? { cities: dto.cities.map((c) => c.trim()).filter(Boolean) }
          : {}),
        ...(dto.flatRate !== undefined ? { flatRate: dto.flatRate } : {}),
        ...(dto.freeShippingThreshold !== undefined
          ? { freeShippingThreshold: dto.freeShippingThreshold }
          : {}),
        ...(dto.isLocalPickup !== undefined ? { isLocalPickup: dto.isLocalPickup } : {}),
        ...(dto.pickupAddress !== undefined ? { pickupAddress: dto.pickupAddress } : {}),
        ...(dto.estimatedDays !== undefined ? { estimatedDays: dto.estimatedDays } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });

    return {
      ...updated,
      flatRate: Number(updated.flatRate),
      freeShippingThreshold:
        updated.freeShippingThreshold !== null ? Number(updated.freeShippingThreshold) : null,
    };
  }

  async deleteShippingZone(
    tenant: ResolvedTenantContext,
    user: AuthenticatedUserContext,
    zoneId: string,
  ) {
    await this.assertTenantAccess(tenant, user, [TenantMemberRole.OWNER, TenantMemberRole.ADMIN]);
    const db = this.prisma.forTenant(tenant.id);

    const existing = await db.shippingZone.findFirst({ where: { id: zoneId } });
    if (!existing) {
      throw new NotFoundException('Zona de envío no encontrada en esta tienda.');
    }

    await db.shippingZone.delete({ where: { id: zoneId } });
    return { deleted: true, id: zoneId };
  }

  // ============================================================================
  // STORE CUSTOMERS CRM (RETAIL vs WHOLESALE_B2B)
  // ============================================================================

  async listStoreCustomers(
    tenant: ResolvedTenantContext,
    user: AuthenticatedUserContext,
    query: ListStoreCustomersQueryDto,
  ) {
    await this.assertTenantAccess(tenant, user, [
      TenantMemberRole.OWNER,
      TenantMemberRole.ADMIN,
      TenantMemberRole.STAFF,
    ]);

    const { search, customerTier, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;
    const db = this.prisma.forTenant(tenant.id);

    const where: Prisma.StoreCustomerWhereInput = {};
    if (customerTier) where.customerTier = customerTier;
    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { fullName: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { taxId: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      db.storeCustomer.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          tenantId: true,
          email: true,
          fullName: true,
          phone: true,
          taxId: true,
          customerTier: true,
          emailVerifiedAt: true,
          totalOrders: true,
          totalSpent: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              orders: true,
              addresses: true,
            },
          },
        },
      }),
      db.storeCustomer.count({ where }),
    ]);

    return {
      items: items.map((c) => ({
        ...c,
        totalSpent: Number(c.totalSpent),
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async updateStoreCustomerTier(
    tenant: ResolvedTenantContext,
    user: AuthenticatedUserContext,
    customerId: string,
    dto: UpdateStoreCustomerTierDto,
  ) {
    await this.assertTenantAccess(tenant, user, [TenantMemberRole.OWNER, TenantMemberRole.ADMIN]);
    const db = this.prisma.forTenant(tenant.id);

    const existing = await db.storeCustomer.findFirst({ where: { id: customerId } });
    if (!existing) {
      throw new NotFoundException('Comprador no encontrado en esta tienda.');
    }

    const updated = await db.storeCustomer.update({
      where: { id: customerId },
      data: {
        customerTier: dto.customerTier,
        ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
        ...(dto.taxId !== undefined ? { taxId: dto.taxId } : {}),
      },
      select: {
        id: true,
        tenantId: true,
        email: true,
        fullName: true,
        phone: true,
        taxId: true,
        customerTier: true,
        totalOrders: true,
        totalSpent: true,
        updatedAt: true,
      },
    });

    return {
      ...updated,
      totalSpent: Number(updated.totalSpent),
    };
  }

  private async assertTenantAccess(
    tenant: ResolvedTenantContext,
    user: AuthenticatedUserContext,
    allowedRoles: TenantMemberRole[],
  ): Promise<void> {
    if (user.role === PlatformRole.SUPER_ADMIN || tenant.ownerId === user.sub) {
      return;
    }

    const membership = await this.prisma.forTenant(tenant.id).tenantMember.findUnique({
      where: {
        tenantId_userId: {
          tenantId: tenant.id,
          userId: user.sub,
        },
      },
    });

    if (!membership || !allowedRoles.includes(membership.role)) {
      throw new ForbiddenException(
        'No tienes permisos para administrar la operación de esta tienda.',
      );
    }
  }
}
