import { Prisma } from '@prisma/client';
import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { TenantResolutionService } from '../../common/services/tenant-resolution.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  ListClientsQueryDto,
  UpdateClientProfileDto,
  CreateSubscriptionPaymentDto,
  ListPaymentsQueryDto,
} from './dto/platform-admin.dto';
import {
  PaymentReviewStatus,
  SubscriptionStatus,
  TenantStatus,
  PlatformRole,
  SubscriptionPaymentProvider,
} from '@prisma/client';
import { AuthenticatedUserContext } from '../../common/cls/cls.types';

@Injectable()
export class PlatformAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantResolutionService: TenantResolutionService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async getOverview() {
    const [
      totalStores,
      activeStores,
      trialStores,
      pastDueStores,
      suspendedStores,
      totalOwners,
      activeSubscriptions,
      pendingPayments,
      approvedPaymentsCount,
      totalCustomers,
      totalOrders,
      totalCollectedRevenueResult,
      mrrResult,
    ] = await Promise.all([
      this.prisma.tenant.count(),
      this.prisma.tenant.count({ where: { status: TenantStatus.ACTIVE } }),
      this.prisma.tenant.count({ where: { status: TenantStatus.TRIAL } }),
      this.prisma.tenant.count({ where: { status: TenantStatus.PAST_DUE } }),
      this.prisma.tenant.count({ where: { status: TenantStatus.SUSPENDED } }),
      this.prisma.platformUser.count({ where: { role: PlatformRole.STORE_OWNER } }),
      this.prisma.subscription.count({ where: { status: SubscriptionStatus.ACTIVE } }),
      this.prisma.subscriptionPayment.count({
        where: { reviewStatus: PaymentReviewStatus.PENDING },
      }),
      this.prisma.subscriptionPayment.count({
        where: { reviewStatus: PaymentReviewStatus.APPROVED },
      }),
      this.prisma.storeCustomer.count(),
      this.prisma.order.count(),
      this.prisma.subscriptionPayment.aggregate({
        _sum: { amount: true },
        where: { reviewStatus: PaymentReviewStatus.APPROVED },
      }),
      this.prisma.subscriptionPayment.aggregate({
        _sum: { amount: true },
        where: {
          reviewStatus: PaymentReviewStatus.APPROVED,
          paidAt: { gte: new Date(new Date().setMonth(new Date().getMonth() - 1)) },
        },
      }),
    ]);

    return {
      totalStores,
      activeStores,
      trialStores,
      pastDueStores,
      suspendedStores,
      totalOwners,
      activeSubscriptions,
      mrr: Number(mrrResult._sum.amount ?? 0),
      pendingPayments,
      approvedPaymentsCount,
      totalCollectedRevenue: Number(totalCollectedRevenueResult._sum.amount ?? 0),
      totalCustomers,
      totalOrders,
      storesByStatus: {
        TRIAL: trialStores,
        ACTIVE: activeStores,
        PAST_DUE: pastDueStores,
        SUSPENDED: suspendedStores,
      },
    };
  }

  async listClients(query: ListClientsQueryDto) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { search, tenantStatus, planCode, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.PlatformUserWhereInput = {
      OR: [{ role: PlatformRole.STORE_OWNER }, { ownedTenants: { some: {} } }],
    };

    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { fullName: { contains: search, mode: 'insensitive' } },
        { ownerProfile: { legalName: { contains: search, mode: 'insensitive' } } },
      ];
    }

    // Complex tenant filters might need more specific Prisma queries.
    // For now, simplify based on available relations.

    const [items, total] = await Promise.all([
      this.prisma.platformUser.findMany({
        where,
        skip,
        take: limit,
        include: {
          ownerProfile: true,
          ownedTenants: { include: { subscription: { include: { plan: true } } } },
        },
      }),
      this.prisma.platformUser.count({ where }),
    ]);

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getClientDetail(ownerId: string) {
    const client = await this.prisma.platformUser.findUnique({
      where: { id: ownerId },
      include: {
        ownerProfile: true,
        ownedTenants: { include: { subscription: { include: { plan: true } } } },
      },
    });

    if (!client) throw new NotFoundException('Cliente no encontrado.');
    return client;
  }

  async updateClientProfile(ownerId: string, dto: UpdateClientProfileDto) {
    return await this.prisma.$transaction(async (tx) => {
      await tx.platformUser.update({
        where: { id: ownerId },
        data: {
          fullName: dto.fullName ?? undefined,
          isActive: dto.isActive ?? undefined,
        },
      });

      await tx.tenantOwnerProfile.upsert({
        where: { userId: ownerId },
        update: {
          legalName: dto.legalName ?? undefined,
          taxId: dto.taxId ?? undefined,
          phoneWhatsapp: dto.phoneWhatsapp ?? undefined,
          country: dto.country ?? undefined,
          city: dto.city ?? undefined,
          fiscalAddress: dto.fiscalAddress ?? undefined,
          businessCategory: dto.businessCategory ?? undefined,
          acquisitionSource: dto.acquisitionSource ?? undefined,
          internalAdminNotes: dto.internalAdminNotes ?? undefined,
          onboardingCompleted: dto.onboardingCompleted ?? undefined,
        },
        create: {
          userId: ownerId,
          legalName: dto.legalName ?? '',
          taxId: dto.taxId ?? '',
          phoneWhatsapp: dto.phoneWhatsapp ?? '',
          country: dto.country ?? '',
          city: dto.city ?? '',
          fiscalAddress: dto.fiscalAddress ?? '',
          businessCategory: dto.businessCategory ?? '',
          acquisitionSource: dto.acquisitionSource ?? '',
          internalAdminNotes: dto.internalAdminNotes ?? '',
          onboardingCompleted: dto.onboardingCompleted ?? false,
        },
      });

      return await this.getClientDetail(ownerId);
    });
  }

  async updateTenantStatus(tenantId: string, status: TenantStatus) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { customDomains: true },
    });

    if (!tenant) {
      throw new NotFoundException('Tienda no encontrada.');
    }

    const updated = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { status },
    });

    const hostnames = tenant.customDomains.map((d) => d.hostname);
    await this.tenantResolutionService.invalidateTenantCache(tenant.slug, hostnames);

    return updated;
  }

  async listPayments(query: ListPaymentsQueryDto) {
    const { reviewStatus, tenantId, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;
    const where: Prisma.SubscriptionPaymentWhereInput = {};
    if (reviewStatus) where.reviewStatus = reviewStatus;
    if (tenantId) where.subscription = { tenantId };

    const [items, total] = await Promise.all([
      this.prisma.subscriptionPayment.findMany({
        where,
        skip,
        take: limit,
        include: { subscription: { include: { tenant: true } } },
      }),
      this.prisma.subscriptionPayment.count({ where }),
    ]);

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async createPayment(dto: CreateSubscriptionPaymentDto) {
    let subId = dto.subscriptionId;
    if (dto.tenantId && !subId) {
      const sub = await this.prisma.subscription.findUnique({ where: { tenantId: dto.tenantId } });
      if (!sub) throw new NotFoundException('Suscripción no encontrada.');
      subId = sub.id;
    }
    if (!subId) throw new BadRequestException('Suscripción o tienda requerida.');

    return await this.prisma.subscriptionPayment.create({
      data: {
        subscriptionId: subId,
        provider:
          (dto.provider as SubscriptionPaymentProvider) ??
          SubscriptionPaymentProvider.MANUAL_TRANSFER,
        amount: dto.amount,
        currency: dto.currency ?? 'USD',
        externalReference: dto.externalReference,
        receiptFileKey: dto.receiptFileKey,
        reviewStatus: PaymentReviewStatus.PENDING,
      },
    });
  }

  async reviewPayment(
    paymentId: string,
    adminUser: AuthenticatedUserContext,
    reviewStatus: PaymentReviewStatus,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    note?: string,
  ) {
    return await this.prisma.$transaction(async (tx) => {
      const payment = await tx.subscriptionPayment.findUnique({
        where: { id: paymentId },
        include: {
          subscription: {
            include: {
              tenant: { include: { customDomains: true } },
              plan: true,
            },
          },
        },
      });

      if (!payment) {
        throw new NotFoundException('Pago no encontrado.');
      }

      if (payment.reviewStatus !== PaymentReviewStatus.PENDING) {
        throw new ConflictException('Este pago ya ha sido procesado.');
      }

      const updatedPayment = await tx.subscriptionPayment.update({
        where: { id: paymentId },
        data: {
          reviewStatus,
          reviewedByUserId: adminUser.sub,
          paidAt: reviewStatus === PaymentReviewStatus.APPROVED ? new Date() : null,
        },
      });

      if (reviewStatus === PaymentReviewStatus.APPROVED) {
        await tx.subscription.update({
          where: { id: payment.subscriptionId },
          data: {
            status: SubscriptionStatus.ACTIVE,
            currentPeriodStart: new Date(),
            currentPeriodEnd: new Date(new Date().setMonth(new Date().getMonth() + 1)),
            gracePeriodEndsAt: null,
          },
        });

        await tx.tenant.update({
          where: { id: payment.subscription.tenantId },
          data: { status: TenantStatus.ACTIVE },
        });

        const hostnames = payment.subscription.tenant.customDomains.map((d) => d.hostname);
        await this.tenantResolutionService.invalidateTenantCache(
          payment.subscription.tenant.slug,
          hostnames,
        );

        await this.notificationsService.sendSubscriptionPaymentApproved({
          to: payment.subscription.tenant.contactEmail ?? '',
          ownerName: 'Owner', // Should fetch owner name
          storeName: payment.subscription.tenant.name,
          planName: payment.subscription.plan.name,
          amount: payment.amount.toString(),
          currency: payment.currency,
          externalReference: payment.externalReference ?? undefined,
        });
      }

      return updatedPayment;
    });
  }
}
