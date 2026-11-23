import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BillingCycle,
  Plan,
  PlatformRole,
  Prisma,
  StoreTheme,
  Subscription,
  SubscriptionStatus,
  Tenant,
  TenantMemberRole,
  TenantStatus,
} from '@prisma/client';
import {
  AuthenticatedUserContext,
  RequestWithContext,
  ResolvedTenantContext,
} from '../../common/cls/cls.types';
import { TenantResolutionService } from '../../common/services/tenant-resolution.service';
import { PrismaService } from '../../database/prisma.service';
import {
  CreateTenantDto,
  SlugAvailabilityDto,
  StoreThemeDto,
  TenantDetailDto,
  UpdateStoreThemeDto,
} from './dto/tenant.dto';
import { RESERVED_TENANT_SLUGS, TENANT_SLUG_REGEX, TRIAL_DAYS } from './tenants.constants';

type TenantWithDetails = Tenant & {
  theme: StoreTheme | null;
  subscription: (Subscription & { plan: Plan }) | null;
};

@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantResolutionService: TenantResolutionService,
  ) {}

  async resolvePublicTenant(req: RequestWithContext, slugQuery?: string): Promise<TenantDetailDto> {
    let tenantRecord: TenantWithDetails | null = null;

    if (req.tenant) {
      tenantRecord = await this.prisma.tenant.findUnique({
        where: { id: req.tenant.id },
        include: {
          theme: true,
          subscription: { include: { plan: true } },
        },
      });
    } else if (slugQuery && slugQuery.trim()) {
      const normalizedSlug = slugQuery.trim().toLowerCase();
      if (RESERVED_TENANT_SLUGS.has(normalizedSlug)) {
        throw new NotFoundException('Tienda no encontrada o dominio no configurado.');
      }

      tenantRecord = await this.prisma.tenant.findUnique({
        where: { slug: normalizedSlug },
        include: {
          theme: true,
          subscription: { include: { plan: true } },
        },
      });

      if (
        tenantRecord &&
        tenantRecord.status === TenantStatus.SUSPENDED &&
        req.user?.role !== PlatformRole.SUPER_ADMIN
      ) {
        throw new ForbiddenException({
          message: 'La tienda se encuentra suspendida temporalmente.',
          code: 'TENANT_SUSPENDED',
        });
      }
    }

    if (!tenantRecord) {
      throw new NotFoundException('Tienda no encontrada o dominio no configurado.');
    }

    return this.serializeTenantDetail(tenantRecord);
  }

  async checkSlugAvailability(rawSlug: string): Promise<SlugAvailabilityDto> {
    const slug = rawSlug.trim().toLowerCase();
    if (slug.length < 3 || slug.length > 63 || !TENANT_SLUG_REGEX.test(slug)) {
      return {
        slug,
        available: false,
        reason: 'Usa entre 3 y 63 caracteres: solo minúsculas, números y guiones medios.',
      };
    }

    if (RESERVED_TENANT_SLUGS.has(slug)) {
      return {
        slug,
        available: false,
        reason: 'Este subdominio está reservado por la plataforma.',
      };
    }

    const existing = await this.prisma.tenant.findUnique({
      where: { slug },
      select: { id: true },
    });

    if (existing) {
      return {
        slug,
        available: false,
        reason: 'Este subdominio ya está ocupado por otra tienda.',
      };
    }

    return {
      slug,
      available: true,
      reason: null,
    };
  }

  async createTenant(
    user: AuthenticatedUserContext,
    dto: CreateTenantDto,
  ): Promise<TenantDetailDto> {
    const slug = dto.slug.trim().toLowerCase();
    if (RESERVED_TENANT_SLUGS.has(slug)) {
      throw new BadRequestException('El subdominio solicitado está reservado por la plataforma.');
    }

    const existing = await this.prisma.tenant.findUnique({ where: { slug } });
    if (existing) {
      throw new ConflictException('El subdominio ya está en uso por otra tienda.');
    }

    const plan = dto.planId
      ? await this.prisma.plan.findFirst({ where: { id: dto.planId, isActive: true } })
      : await this.prisma.plan.findFirst({
          where: {
            code: (dto.planCode ?? 'EMPRENDEDOR').trim().toUpperCase(),
            isActive: true,
          },
        });

    if (!plan) {
      throw new BadRequestException('El plan seleccionado no existe o no está activo.');
    }

    const trialEnd = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

    let created: TenantWithDetails;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const owner = await tx.platformUser.findUniqueOrThrow({
          where: { id: user.sub },
        });

        await tx.tenantOwnerProfile.upsert({
          where: { userId: user.sub },
          create: {
            userId: user.sub,
            legalName: dto.legalName ?? null,
            taxId: dto.taxId ?? null,
            phoneWhatsapp: dto.whatsappSalesNumber ?? null,
            country: dto.country ?? 'LATAM',
            city: dto.city ?? null,
            onboardingCompleted: true,
          },
          update: {
            onboardingCompleted: true,
            ...(dto.legalName !== undefined ? { legalName: dto.legalName } : {}),
            ...(dto.taxId !== undefined ? { taxId: dto.taxId } : {}),
            ...(dto.whatsappSalesNumber !== undefined
              ? { phoneWhatsapp: dto.whatsappSalesNumber }
              : {}),
            ...(dto.country !== undefined ? { country: dto.country } : {}),
            ...(dto.city !== undefined ? { city: dto.city } : {}),
          },
        });

        return tx.tenant.create({
          data: {
            slug,
            name: dto.name,
            description: dto.description ?? null,
            ownerId: user.sub,
            status: TenantStatus.TRIAL,
            currency: (dto.currency ?? 'USD').toUpperCase(),
            whatsappSalesNumber: dto.whatsappSalesNumber ?? null,
            contactEmail: dto.contactEmail ?? owner.email,
            minWholesaleAmount: dto.minWholesaleAmount ?? null,
            minWholesaleQty: dto.minWholesaleQty ?? null,
            members: {
              create: {
                userId: user.sub,
                role: TenantMemberRole.OWNER,
              },
            },
            theme: {
              create: {
                primaryColor: dto.primaryColor ?? '#0F172A',
                accentColor: dto.accentColor ?? '#2563EB',
                heroTitle: dto.heroTitle ?? dto.name,
              },
            },
            subscription: {
              create: {
                planId: plan.id,
                billingCycle: dto.billingCycle ?? BillingCycle.MONTHLY,
                status: SubscriptionStatus.TRIALING,
                currentPeriodEnd: trialEnd,
              },
            },
          },
          include: {
            theme: true,
            subscription: {
              include: { plan: true },
            },
          },
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('El subdominio ya está en uso por otra tienda.');
      }
      throw error;
    }

    await this.tenantResolutionService.invalidateTenantCache(created.slug);
    return this.serializeTenantDetail(created);
  }

  async listMyTenants(user: AuthenticatedUserContext): Promise<TenantDetailDto[]> {
    const tenants = await this.prisma.tenant.findMany({
      where:
        user.role === PlatformRole.SUPER_ADMIN
          ? undefined
          : {
              OR: [{ ownerId: user.sub }, { members: { some: { userId: user.sub } } }],
            },
      include: {
        theme: true,
        subscription: { include: { plan: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return tenants.map((t) => this.serializeTenantDetail(t));
  }

  async getCurrentTenant(
    req: RequestWithContext,
    user: AuthenticatedUserContext,
  ): Promise<TenantDetailDto> {
    const hasExplicitTenantHeader = Boolean(
      req.headers['x-tenant-host'] || req.headers['x-tenant-slug'],
    );

    if (req.tenant) {
      await this.assertTenantAccess(req.tenant, user, [
        TenantMemberRole.OWNER,
        TenantMemberRole.ADMIN,
        TenantMemberRole.STAFF,
      ]);

      const tenant = await this.prisma.tenant.findUnique({
        where: { id: req.tenant.id },
        include: {
          theme: true,
          subscription: { include: { plan: true } },
        },
      });
      if (!tenant) {
        throw new NotFoundException('Tienda no encontrada o dominio no configurado.');
      }
      return this.serializeTenantDetail(tenant);
    }

    if (hasExplicitTenantHeader) {
      throw new NotFoundException('Tienda no encontrada o dominio no configurado.');
    }

    const fallbackTenant = await this.prisma.tenant.findFirst({
      where:
        user.role === PlatformRole.SUPER_ADMIN
          ? undefined
          : {
              OR: [{ ownerId: user.sub }, { members: { some: { userId: user.sub } } }],
            },
      include: {
        theme: true,
        subscription: { include: { plan: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    if (!fallbackTenant) {
      throw new NotFoundException('No se encontró una tienda asociada a tu cuenta.');
    }

    if (
      fallbackTenant.status === TenantStatus.SUSPENDED &&
      user.role !== PlatformRole.SUPER_ADMIN
    ) {
      throw new ForbiddenException({
        message: 'La tienda se encuentra suspendida temporalmente.',
        code: 'TENANT_SUSPENDED',
      });
    }

    return this.serializeTenantDetail(fallbackTenant);
  }

  async updateCurrentTheme(
    tenant: ResolvedTenantContext,
    user: AuthenticatedUserContext,
    dto: UpdateStoreThemeDto,
  ): Promise<StoreThemeDto> {
    await this.assertTenantAccess(tenant, user, [TenantMemberRole.OWNER, TenantMemberRole.ADMIN]);

    const db = this.prisma.forTenant(tenant.id);
    const updateFields = {
      ...(dto.logoUrl !== undefined ? { logoUrl: dto.logoUrl } : {}),
      ...(dto.faviconUrl !== undefined ? { faviconUrl: dto.faviconUrl } : {}),
      ...(dto.primaryColor !== undefined ? { primaryColor: dto.primaryColor } : {}),
      ...(dto.accentColor !== undefined ? { accentColor: dto.accentColor } : {}),
      ...(dto.darkModeDefault !== undefined ? { darkModeDefault: dto.darkModeDefault } : {}),
      ...(dto.heroTitle !== undefined ? { heroTitle: dto.heroTitle } : {}),
      ...(dto.heroSubtitle !== undefined ? { heroSubtitle: dto.heroSubtitle } : {}),
      ...(dto.announcementText !== undefined ? { announcementText: dto.announcementText } : {}),
      ...(dto.heroBanners !== undefined
        ? {
            heroBanners:
              dto.heroBanners === null
                ? Prisma.JsonNull
                : (dto.heroBanners as Prisma.InputJsonValue),
          }
        : {}),
    };

    const updated = await db.storeTheme.upsert({
      where: { tenantId: tenant.id },
      create: {
        tenantId: tenant.id,
        ...updateFields,
      },
      update: updateFields,
    });

    const customDomains = await db.customDomain.findMany({
      select: { hostname: true },
    });

    await this.tenantResolutionService.invalidateTenantCache(
      tenant.slug,
      customDomains.map((d) => d.hostname),
    );

    return this.serializeTheme(updated);
  }

  private async assertTenantAccess(
    tenant: ResolvedTenantContext,
    user: AuthenticatedUserContext,
    allowedRoles: TenantMemberRole[],
  ): Promise<void> {
    if (user.role === PlatformRole.SUPER_ADMIN) {
      return;
    }

    if (tenant.ownerId === user.sub) {
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
      throw new ForbiddenException('No tienes permisos para acceder o modificar esta tienda.');
    }
  }

  private serializeTheme(theme: StoreTheme): StoreThemeDto {
    return {
      id: theme.id,
      tenantId: theme.tenantId,
      logoUrl: theme.logoUrl,
      faviconUrl: theme.faviconUrl,
      primaryColor: theme.primaryColor,
      accentColor: theme.accentColor,
      darkModeDefault: theme.darkModeDefault,
      heroTitle: theme.heroTitle,
      heroSubtitle: theme.heroSubtitle,
      heroBanners: theme.heroBanners,
      announcementText: theme.announcementText,
      updatedAt: theme.updatedAt.toISOString(),
    };
  }

  private serializeTenantDetail(tenant: TenantWithDetails): TenantDetailDto {
    return {
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      description: tenant.description,
      status: tenant.status,
      currency: tenant.currency,
      whatsappSalesNumber: tenant.whatsappSalesNumber,
      contactEmail: tenant.contactEmail,
      minWholesaleAmount:
        tenant.minWholesaleAmount !== null ? Number(tenant.minWholesaleAmount) : null,
      minWholesaleQty: tenant.minWholesaleQty,
      stockReservationMins: tenant.stockReservationMins,
      theme: tenant.theme ? this.serializeTheme(tenant.theme) : null,
      subscription: tenant.subscription
        ? {
            id: tenant.subscription.id,
            planId: tenant.subscription.planId,
            billingCycle: tenant.subscription.billingCycle,
            status: tenant.subscription.status,
            currentPeriodStart: tenant.subscription.currentPeriodStart.toISOString(),
            currentPeriodEnd: tenant.subscription.currentPeriodEnd.toISOString(),
            gracePeriodEndsAt: tenant.subscription.gracePeriodEndsAt
              ? tenant.subscription.gracePeriodEndsAt.toISOString()
              : null,
            plan: {
              id: tenant.subscription.plan.id,
              code: tenant.subscription.plan.code,
              name: tenant.subscription.plan.name,
              maxProducts: tenant.subscription.plan.maxProducts,
              maxStaff: tenant.subscription.plan.maxStaff,
              allowCustomDomain: tenant.subscription.plan.allowCustomDomain,
              allowCsvImport: tenant.subscription.plan.allowCsvImport,
              allowAbandonedCart: tenant.subscription.plan.allowAbandonedCart,
              allowWholesale: tenant.subscription.plan.allowWholesale,
              allowCoupons: tenant.subscription.plan.allowCoupons,
            },
          }
        : null,
      createdAt: tenant.createdAt.toISOString(),
      updatedAt: tenant.updatedAt.toISOString(),
    };
  }
}
