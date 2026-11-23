import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClsService } from 'nestjs-cls';
import { EnvConfig } from '../../config/env.validation';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.module';
import { CLS_TENANT, CLS_TENANT_ID } from '../cls/cls.constants';
import { AppClsStore, RequestWithContext, ResolvedTenantContext } from '../cls/cls.types';

const TENANT_CACHE_TTL_SECONDS = 600;
const RESERVED_PLATFORM_SUBDOMAINS = new Set(['admin', 'panel', 'api', 'auth', 'www']);

@Injectable()
export class TenantResolutionService {
  private readonly logger = new Logger(TenantResolutionService.name);
  private readonly baseHostname: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly config: ConfigService<EnvConfig, true>,
  ) {
    const rawBaseDomain = this.config.get('PLATFORM_BASE_DOMAIN', { infer: true });
    this.baseHostname = this.normalizeHostname(rawBaseDomain) ?? 'localhost';
  }

  async resolveFromRequest(req: RequestWithContext): Promise<ResolvedTenantContext | null> {
    if (req.tenant) {
      this.syncCls(req.tenant);
      return req.tenant;
    }

    if (this.cls.isActive() && this.cls.has(CLS_TENANT)) {
      const clsTenant = this.cls.get(CLS_TENANT);
      if (clsTenant) {
        req.tenant = clsTenant;
        req.tenantId = clsTenant.id;
        return clsTenant;
      }
    }

    const xTenantHost = this.normalizeHostname(req.headers['x-tenant-host']);
    const xTenantSlug = this.extractHeaderValue(req.headers['x-tenant-slug'])?.toLowerCase();
    const requestHost = this.normalizeHostname(req.headers.host);

    let resolved: ResolvedTenantContext | null = null;

    if (xTenantHost) {
      if (this.isCandidateTenantHost(xTenantHost)) {
        resolved = await this.resolveByHostname(xTenantHost);
      } else if (this.isBarePlatformHost(xTenantHost) && xTenantSlug) {
        resolved = await this.resolveBySlug(xTenantSlug);
      }
    } else if (xTenantSlug) {
      resolved = await this.resolveBySlug(xTenantSlug);
    } else if (requestHost && this.isCandidateTenantHost(requestHost)) {
      resolved = await this.resolveByHostname(requestHost);
    }

    if (resolved) {
      req.tenant = resolved;
      req.tenantId = resolved.id;
      this.syncCls(resolved);
    }

    return resolved;
  }

  async invalidateTenantCache(slug: string, customHostnames: string[] = []): Promise<void> {
    const normalizedSlug = slug.trim().toLowerCase();
    const keys = new Set<string>();

    if (normalizedSlug) {
      keys.add(`tenant:slug:${normalizedSlug}`);
      keys.add(`tenant:host:${normalizedSlug}.${this.baseHostname}`);
    }

    for (const rawHost of customHostnames) {
      const normalizedHost = this.normalizeHostname(rawHost);
      if (normalizedHost) {
        keys.add(`tenant:host:${normalizedHost}`);
      }
    }

    await Promise.all(
      Array.from(keys).map(async (key) => {
        try {
          await this.redis.del(key);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.warn(`No se pudo invalidar caché Redis (${key}): ${message}`);
        }
      }),
    );
  }

  private syncCls(tenant: ResolvedTenantContext): void {
    if (this.cls.isActive()) {
      this.cls.set(CLS_TENANT_ID, tenant.id);
      this.cls.set(CLS_TENANT, tenant);
    }
  }

  private extractHeaderValue(raw: string | string[] | undefined): string | null {
    if (!raw) return null;
    const first = Array.isArray(raw) ? raw[0] : raw;
    if (!first) return null;
    const trimmed = first.split(',')[0]?.trim();
    return trimmed ? trimmed : null;
  }

  private normalizeHostname(raw: string | string[] | undefined): string | null {
    const value = this.extractHeaderValue(raw);
    if (!value) return null;

    let hostname = value.toLowerCase();
    if (hostname.startsWith('[')) {
      const closingBracket = hostname.indexOf(']');
      if (closingBracket !== -1) {
        hostname = hostname.slice(1, closingBracket);
      }
    } else {
      const colonIdx = hostname.indexOf(':');
      if (colonIdx !== -1) {
        hostname = hostname.slice(0, colonIdx);
      }
    }

    hostname = hostname.replace(/\.+$/, '');
    return hostname || null;
  }

  private isBarePlatformHost(hostname: string): boolean {
    return (
      hostname === this.baseHostname ||
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1'
    );
  }

  private isReservedPlatformSubdomain(hostname: string): boolean {
    const suffix = `.${this.baseHostname}`;
    if (hostname.endsWith(suffix)) {
      const sub = hostname.slice(0, -suffix.length);
      if (!sub || sub.includes('.') || RESERVED_PLATFORM_SUBDOMAINS.has(sub)) {
        return true;
      }
    }

    return false;
  }

  private isCandidateTenantHost(hostname: string): boolean {
    return !this.isBarePlatformHost(hostname) && !this.isReservedPlatformSubdomain(hostname);
  }

  private async resolveByHostname(hostname: string): Promise<ResolvedTenantContext | null> {
    const cacheKey = `tenant:host:${hostname}`;
    const cached = await this.safeGetCache(cacheKey);
    if (cached) {
      return cached;
    }

    let tenantRecord: {
      id: string;
      slug: string;
      name: string;
      status: ResolvedTenantContext['status'];
      currency: string;
      ownerId: string;
      subscription: {
        status: NonNullable<ResolvedTenantContext['subscriptionStatus']>;
        gracePeriodEndsAt: Date | null;
      } | null;
    } | null = null;

    const suffix = `.${this.baseHostname}`;
    if (hostname.endsWith(suffix)) {
      const slug = hostname.slice(0, -suffix.length);
      if (!slug || slug.includes('.') || RESERVED_PLATFORM_SUBDOMAINS.has(slug)) {
        return null;
      }
      tenantRecord = await this.prisma.tenant.findUnique({
        where: { slug },
        include: {
          subscription: {
            select: { status: true, gracePeriodEndsAt: true },
          },
        },
      });
    } else {
      const customDomain = await this.prisma.customDomain.findUnique({
        where: { hostname },
        include: {
          tenant: {
            include: {
              subscription: {
                select: { status: true, gracePeriodEndsAt: true },
              },
            },
          },
        },
      });
      if (customDomain?.isVerified && customDomain.tenant) {
        tenantRecord = customDomain.tenant;
      }
    }

    if (!tenantRecord) {
      return null;
    }

    const context: ResolvedTenantContext = {
      id: tenantRecord.id,
      slug: tenantRecord.slug,
      name: tenantRecord.name,
      status: tenantRecord.status,
      currency: tenantRecord.currency,
      ownerId: tenantRecord.ownerId,
      subscriptionStatus: tenantRecord.subscription?.status ?? null,
      gracePeriodEndsAt: tenantRecord.subscription?.gracePeriodEndsAt
        ? tenantRecord.subscription.gracePeriodEndsAt.toISOString()
        : null,
    };

    await this.safeSetCache(cacheKey, context);
    return context;
  }

  private async resolveBySlug(slug: string): Promise<ResolvedTenantContext | null> {
    const cacheKey = `tenant:slug:${slug}`;
    const cached = await this.safeGetCache(cacheKey);
    if (cached) {
      return cached;
    }

    const tenantRecord = await this.prisma.tenant.findUnique({
      where: { slug },
      include: {
        subscription: {
          select: { status: true, gracePeriodEndsAt: true },
        },
      },
    });

    if (!tenantRecord) {
      return null;
    }

    const context: ResolvedTenantContext = {
      id: tenantRecord.id,
      slug: tenantRecord.slug,
      name: tenantRecord.name,
      status: tenantRecord.status,
      currency: tenantRecord.currency,
      ownerId: tenantRecord.ownerId,
      subscriptionStatus: tenantRecord.subscription?.status ?? null,
      gracePeriodEndsAt: tenantRecord.subscription?.gracePeriodEndsAt
        ? tenantRecord.subscription.gracePeriodEndsAt.toISOString()
        : null,
    };

    await this.safeSetCache(cacheKey, context);
    return context;
  }

  private async safeGetCache(key: string): Promise<ResolvedTenantContext | null> {
    try {
      return await this.redis.getJson<ResolvedTenantContext>(key);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`No se pudo leer caché Redis (${key}): ${message}`);
      return null;
    }
  }

  private async safeSetCache(key: string, value: ResolvedTenantContext): Promise<void> {
    try {
      await this.redis.setJson(key, value, TENANT_CACHE_TTL_SECONDS);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`No se pudo escribir caché Redis (${key}): ${message}`);
    }
  }
}
