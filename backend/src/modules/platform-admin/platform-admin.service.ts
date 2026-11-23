import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BillingCycle,
  PaymentReviewStatus,
  PlatformRole,
  Prisma,
  SubscriptionPaymentProvider,
  SubscriptionStatus,
  TenantStatus,
} from '@prisma/client';
import { AuthenticatedUserContext } from '../../common/cls/cls.types';
import { TenantResolutionService } from '../../common/services/tenant-resolution.service';
import { PrismaService } from '../../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  CreateSubscriptionPaymentDto,
  ListClientsQueryDto,
  ListPaymentsQueryDto,
  UpdateClientProfileDto,
} from './dto/platform-admin.dto';

@Injectable()
export class PlatformAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantResolutionService: TenantResolutionService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async getOverview() {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [
      totalStores,
      activeStores,
      trialStores,
      pastDueStores,
      suspendedStores,
      newStoresLast30Days,
      totalOwners,
      activeSubscriptions,
      activeSubscriptionRows,
      pendingPayments,
      approvedPaymentsCount,
      totalCustomers,
      totalOrders,
      totalCollectedRevenueResult,
      recentCollectedRevenueResult,
    ] = await Promise.all([
      this.prisma.tenant.count(),
      this.prisma.tenant.count({ where: { status: TenantStatus.ACTIVE } }),
      this.prisma.tenant.count({ where: { status: TenantStatus.TRIAL } }),
      this.prisma.tenant.count({ where: { status: TenantStatus.PAST_DUE } }),
      this.prisma.tenant.count({ where: { status: TenantStatus.SUSPENDED } }),
      this.prisma.tenant.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
      this.prisma.platformUser.count({ where: { role: PlatformRole.STORE_OWNER } }),
      this.prisma.subscription.count({ where: { status: SubscriptionStatus.ACTIVE } }),
      this.prisma.subscription.findMany({
        where: { status: SubscriptionStatus.ACTIVE },
        select: {
          billingCycle: true,
          plan: { select: { priceMonthly: true, priceYearly: true } },
        },
      }),
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
          paidAt: { gte: thirtyDaysAgo },
        },
      }),
    ]);

    const normalizedMrr = Number(
      activeSubscriptionRows
        .reduce((acc, sub) => {
          const monthlyValue =
            sub.billingCycle === BillingCycle.YEARLY
              ? Number(sub.plan.priceYearly) / 12
              : Number(sub.plan.priceMonthly);
          return acc + monthlyValue;
        }, 0)
        .toFixed(2),
    );

    const recentCollectedRevenue = Number(recentCollectedRevenueResult._sum.amount ?? 0);

    return {
      totalStores,
      activeStores,
      trialStores,
      pastDueStores,
      suspendedStores,
      newStoresLast30Days,
      storesAtRisk: pastDueStores + suspendedStores,
      totalOwners,
      activeSubscriptions,
      mrr: normalizedMrr,
      recentCollectedRevenue,
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
    const { search, tenantStatus, planCode, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const andConditions: Prisma.PlatformUserWhereInput[] = [
      {
        OR: [{ role: PlatformRole.STORE_OWNER }, { ownedTenants: { some: {} } }],
      },
    ];

    if (search && search.trim()) {
      const term = search.trim();
      andConditions.push({
        OR: [
          { email: { contains: term, mode: 'insensitive' } },
          { fullName: { contains: term, mode: 'insensitive' } },
          { ownerProfile: { legalName: { contains: term, mode: 'insensitive' } } },
          { ownerProfile: { taxId: { contains: term, mode: 'insensitive' } } },
          { ownedTenants: { some: { name: { contains: term, mode: 'insensitive' } } } },
          { ownedTenants: { some: { slug: { contains: term, mode: 'insensitive' } } } },
        ],
      });
    }

    if (tenantStatus || planCode) {
      const tenantFilter: Prisma.TenantWhereInput = {};
      if (tenantStatus) {
        tenantFilter.status = tenantStatus;
      }
      if (planCode && planCode.trim()) {
        tenantFilter.subscription = {
          plan: { code: planCode.trim().toUpperCase() },
        };
      }
      andConditions.push({
        ownedTenants: { some: tenantFilter },
      });
    }

    const where: Prisma.PlatformUserWhereInput = { AND: andConditions };

    const [rawItems, total] = await Promise.all([
      this.prisma.platformUser.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          fullName: true,
          avatarUrl: true,
          role: true,
          isActive: true,
          emailVerifiedAt: true,
          lastLoginAt: true,
          createdAt: true,
          updatedAt: true,
          ownerProfile: true,
          ownedTenants: {
            include: {
              subscription: {
                include: {
                  plan: true,
                  payments: {
                    orderBy: { createdAt: 'desc' },
                    take: 3,
                  },
                },
              },
              _count: {
                select: {
                  products: true,
                  members: true,
                  orders: true,
                  customers: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.platformUser.count({ where }),
    ]);

    const items = rawItems.map((client) => ({
      ...client,
      ownedTenants: client.ownedTenants.map((tenant) => {
        const maxProducts = tenant.subscription?.plan.maxProducts ?? 0;
        const maxStaff = tenant.subscription?.plan.maxStaff ?? 0;
        const productsUsed = tenant._count.products;
        const staffUsed = tenant._count.members;
        return {
          ...tenant,
          usage: {
            productsUsed,
            maxProducts,
            productsUsagePercent:
              maxProducts > 0 ? Math.min(100, Math.round((productsUsed / maxProducts) * 100)) : 0,
            staffUsed,
            maxStaff,
            staffUsagePercent:
              maxStaff > 0 ? Math.min(100, Math.round((staffUsed / maxStaff) * 100)) : 0,
          },
        };
      }),
    }));

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getClientDetail(ownerId: string) {
    const client = await this.prisma.platformUser.findUnique({
      where: { id: ownerId },
      select: {
        id: true,
        email: true,
        fullName: true,
        avatarUrl: true,
        role: true,
        isActive: true,
        emailVerifiedAt: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
        ownerProfile: true,
        ownedTenants: {
          include: {
            customDomains: true,
            subscription: {
              include: {
                plan: true,
                payments: {
                  orderBy: { createdAt: 'desc' },
                  take: 20,
                },
              },
            },
            _count: {
              select: {
                products: true,
                members: true,
                orders: true,
                customers: true,
              },
            },
          },
        },
      },
    });

    if (!client) throw new NotFoundException('Cliente no encontrado.');

    return {
      ...client,
      ownedTenants: client.ownedTenants.map((tenant) => {
        const maxProducts = tenant.subscription?.plan.maxProducts ?? 0;
        const maxStaff = tenant.subscription?.plan.maxStaff ?? 0;
        const productsUsed = tenant._count.products;
        const staffUsed = tenant._count.members;
        return {
          ...tenant,
          usage: {
            productsUsed,
            maxProducts,
            productsUsagePercent:
              maxProducts > 0 ? Math.min(100, Math.round((productsUsed / maxProducts) * 100)) : 0,
            staffUsed,
            maxStaff,
            staffUsagePercent:
              maxStaff > 0 ? Math.min(100, Math.round((staffUsed / maxStaff) * 100)) : 0,
          },
        };
      }),
    };
  }

  async updateClientProfile(ownerId: string, dto: UpdateClientProfileDto) {
    const existing = await this.prisma.platformUser.findUnique({
      where: { id: ownerId },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException('Cliente no encontrado.');
    }

    await this.prisma.$transaction(async (tx) => {
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
          country: dto.country ?? 'LATAM',
          city: dto.city ?? '',
          fiscalAddress: dto.fiscalAddress ?? '',
          businessCategory: dto.businessCategory ?? '',
          acquisitionSource: dto.acquisitionSource ?? '',
          internalAdminNotes: dto.internalAdminNotes ?? '',
          onboardingCompleted: dto.onboardingCompleted ?? false,
        },
      });
    });

    return this.getClientDetail(ownerId);
  }

  async appendClientNote(ownerId: string, adminUser: AuthenticatedUserContext, note: string) {
    const client = await this.prisma.platformUser.findUnique({
      where: { id: ownerId },
      include: { ownerProfile: true },
    });
    if (!client) {
      throw new NotFoundException('Cliente no encontrado.');
    }

    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 16);
    const entry = `[${timestamp} UTC | ${adminUser.email}] ${note.trim()}`;
    const currentNotes = client.ownerProfile?.internalAdminNotes?.trim();
    const combinedNotes = currentNotes ? `${currentNotes}\n${entry}` : entry;

    await this.prisma.tenantOwnerProfile.upsert({
      where: { userId: ownerId },
      create: {
        userId: ownerId,
        internalAdminNotes: combinedNotes,
      },
      update: {
        internalAdminNotes: combinedNotes,
      },
    });

    return this.getClientDetail(ownerId);
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
        orderBy: { createdAt: 'desc' },
        include: {
          subscription: {
            include: {
              plan: true,
              tenant: {
                include: {
                  owner: { select: { id: true, email: true, fullName: true } },
                },
              },
            },
          },
        },
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
    note?: string,
  ) {
    if (reviewStatus === PaymentReviewStatus.PENDING) {
      throw new BadRequestException('El estado de revisión debe ser APPROVED o REJECTED.');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const payment = await tx.subscriptionPayment.findUnique({
        where: { id: paymentId },
        include: {
          subscription: {
            include: {
              tenant: {
                include: {
                  customDomains: true,
                  owner: { select: { id: true, email: true, fullName: true } },
                },
              },
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

      const now = new Date();
      const updatedPayment = await tx.subscriptionPayment.update({
        where: { id: paymentId },
        data: {
          reviewStatus,
          reviewedByUserId: adminUser.sub,
          paidAt: reviewStatus === PaymentReviewStatus.APPROVED ? now : null,
        },
      });

      if (reviewStatus === PaymentReviewStatus.APPROVED) {
        const nextPeriodEnd = new Date(now);
        nextPeriodEnd.setMonth(
          nextPeriodEnd.getMonth() +
            (payment.subscription.billingCycle === BillingCycle.YEARLY ? 12 : 1),
        );

        await tx.subscription.update({
          where: { id: payment.subscriptionId },
          data: {
            status: SubscriptionStatus.ACTIVE,
            currentPeriodStart: now,
            currentPeriodEnd: nextPeriodEnd,
            gracePeriodEndsAt: null,
            cancelAtPeriodEnd: false,
          },
        });

        await tx.tenant.update({
          where: { id: payment.subscription.tenantId },
          data: { status: TenantStatus.ACTIVE },
        });
      }

      return { updatedPayment, payment };
    });

    const { updatedPayment, payment } = result;
    const recipientEmail =
      payment.subscription.tenant.contactEmail || payment.subscription.tenant.owner.email;
    const ownerName = payment.subscription.tenant.owner.fullName;

    if (reviewStatus === PaymentReviewStatus.APPROVED) {
      const hostnames = payment.subscription.tenant.customDomains.map((d) => d.hostname);
      await this.tenantResolutionService.invalidateTenantCache(
        payment.subscription.tenant.slug,
        hostnames,
      );

      await this.notificationsService.sendSubscriptionPaymentApproved({
        to: recipientEmail,
        ownerName,
        storeName: payment.subscription.tenant.name,
        planName: payment.subscription.plan.name,
        amount: payment.amount.toString(),
        currency: payment.currency,
        externalReference: payment.externalReference ?? undefined,
      });
    } else if (reviewStatus === PaymentReviewStatus.REJECTED) {
      await this.notificationsService.sendSubscriptionPaymentRejected({
        to: recipientEmail,
        ownerName,
        storeName: payment.subscription.tenant.name,
        planName: payment.subscription.plan.name,
        amount: payment.amount.toString(),
        currency: payment.currency,
        reason: note,
        externalReference: payment.externalReference ?? undefined,
      });
    }

    return updatedPayment;
  }
}
