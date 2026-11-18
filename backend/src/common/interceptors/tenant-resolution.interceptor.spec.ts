import { CallHandler, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SubscriptionStatus, TenantStatus } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { lastValueFrom, of } from 'rxjs';
import { EnvConfig } from '../../config/env.validation';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.module';
import { CLS_TENANT, CLS_TENANT_ID } from '../cls/cls.constants';
import { AppClsStore, RequestWithContext } from '../cls/cls.types';
import { TenantResolutionService } from '../services/tenant-resolution.service';
import { TenantResolutionInterceptor } from './tenant-resolution.interceptor';

describe('TenantResolutionInterceptor & TenantResolutionService', () => {
  let service: TenantResolutionService;
  let interceptor: TenantResolutionInterceptor;
  let mockPrisma: {
    tenant: { findUnique: jest.Mock };
    customDomain: { findUnique: jest.Mock };
  };
  let mockRedis: {
    getJson: jest.Mock;
    setJson: jest.Mock;
    del: jest.Mock;
  };
  let clsMap: Map<string, unknown>;
  let mockCls: ClsService<AppClsStore>;

  beforeEach(() => {
    mockPrisma = {
      tenant: { findUnique: jest.fn() },
      customDomain: { findUnique: jest.fn() },
    };
    mockRedis = {
      getJson: jest.fn().mockResolvedValue(null),
      setJson: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
    };
    clsMap = new Map();
    mockCls = {
      isActive: jest.fn(() => true),
      has: jest.fn((key: string) => clsMap.has(key)),
      get: jest.fn((key: string) => clsMap.get(key)),
      set: jest.fn((key: string, val: unknown) => {
        clsMap.set(key, val);
      }),
    } as unknown as ClsService<AppClsStore>;

    const mockConfig = {
      get: jest.fn((key: string) => (key === 'PLATFORM_BASE_DOMAIN' ? 'localhost:3000' : '')),
    } as unknown as ConfigService<EnvConfig, true>;

    service = new TenantResolutionService(
      mockPrisma as unknown as PrismaService,
      mockRedis as unknown as RedisService,
      mockCls,
      mockConfig,
    );
    interceptor = new TenantResolutionInterceptor(service);
  });

  function createHttpContext(headers: Record<string, string>): {
    ctx: ExecutionContext;
    req: RequestWithContext;
  } {
    const req = {
      headers,
      cookies: {},
    } as unknown as RequestWithContext;

    const ctx = {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => req,
      }),
    } as unknown as ExecutionContext;

    return { ctx, req };
  }

  it('prioritizes x-tenant-host over x-tenant-slug and Host, strips port, caches in Redis, and populates CLS', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({
      id: 't-1',
      slug: 'moda-mayorista',
      name: 'Urban Threads Studio',
      status: TenantStatus.ACTIVE,
      currency: 'USD',
      ownerId: 'u-1',
      subscription: { status: SubscriptionStatus.ACTIVE, gracePeriodEndsAt: null },
    });

    const { ctx, req } = createHttpContext({
      'x-tenant-host': 'MODA-MAYORISTA.localhost:3000',
      'x-tenant-slug': 'electro-hogar',
      host: 'localhost:4000',
    });

    const next: CallHandler = { handle: () => of('ok') };
    const result = await lastValueFrom(await interceptor.intercept(ctx, next));

    expect(result).toBe('ok');
    expect(mockRedis.getJson).toHaveBeenCalledWith('tenant:host:moda-mayorista.localhost');
    expect(mockPrisma.tenant.findUnique).toHaveBeenCalledWith({
      where: { slug: 'moda-mayorista' },
      include: { subscription: { select: { status: true, gracePeriodEndsAt: true } } },
    });
    expect(mockRedis.setJson).toHaveBeenCalledWith(
      'tenant:host:moda-mayorista.localhost',
      expect.objectContaining({ id: 't-1', slug: 'moda-mayorista' }),
      600,
    );
    expect(req.tenantId).toBe('t-1');
    expect(clsMap.get(CLS_TENANT_ID)).toBe('t-1');
    expect(clsMap.get(CLS_TENANT)).toEqual(expect.objectContaining({ slug: 'moda-mayorista' }));
  });

  it('returns cached tenant on Redis hit without hitting PostgreSQL', async () => {
    mockRedis.getJson.mockResolvedValueOnce({
      id: 't-cached',
      slug: 'electro-hogar',
      name: 'ElectroHogar',
      status: TenantStatus.TRIAL,
      currency: 'USD',
      ownerId: 'u-2',
    });

    const { ctx, req } = createHttpContext({
      host: 'electro-hogar.localhost:3000',
    });

    await lastValueFrom(await interceptor.intercept(ctx, { handle: () => of(null) }));

    expect(mockPrisma.tenant.findUnique).not.toHaveBeenCalled();
    expect(req.tenantId).toBe('t-cached');
  });

  it('skips bare/reserved platform hosts and falls back to x-tenant-slug when x-tenant-host is bare localhost', async () => {
    const bareCtx = createHttpContext({ host: 'localhost:4000' });
    await service.resolveFromRequest(bareCtx.req);
    expect(bareCtx.req.tenant).toBeUndefined();
    expect(mockPrisma.tenant.findUnique).not.toHaveBeenCalled();

    const reservedCtx = createHttpContext({ 'x-tenant-host': 'admin.localhost:3000' });
    await service.resolveFromRequest(reservedCtx.req);
    expect(reservedCtx.req.tenant).toBeUndefined();

    mockPrisma.tenant.findUnique.mockResolvedValueOnce({
      id: 't-2',
      slug: 'electro-hogar',
      name: 'ElectroHogar',
      status: TenantStatus.TRIAL,
      currency: 'USD',
      ownerId: 'u-2',
      subscription: null,
    });
    const fallbackCtx = createHttpContext({
      'x-tenant-host': 'localhost:3000',
      'x-tenant-slug': 'electro-hogar',
    });
    const resolved = await service.resolveFromRequest(fallbackCtx.req);
    expect(resolved?.id).toBe('t-2');
    expect(mockRedis.setJson).toHaveBeenCalledWith(
      'tenant:slug:electro-hogar',
      expect.objectContaining({ id: 't-2' }),
      600,
    );
  });

  it('resolves verified CustomDomain and ignores unverified CustomDomain', async () => {
    mockPrisma.customDomain.findUnique.mockResolvedValueOnce({
      isVerified: false,
      tenant: { id: 't-3' },
    });
    const unverified = createHttpContext({ 'x-tenant-host': 'shop.ejemplo.com' });
    await expect(service.resolveFromRequest(unverified.req)).resolves.toBeNull();

    mockPrisma.customDomain.findUnique.mockResolvedValueOnce({
      isVerified: true,
      tenant: {
        id: 't-3',
        slug: 'ejemplo',
        name: 'Ejemplo Store',
        status: TenantStatus.ACTIVE,
        currency: 'USD',
        ownerId: 'u-3',
        subscription: null,
      },
    });
    const verified = createHttpContext({ 'x-tenant-host': 'shop.ejemplo.com' });
    const resolved = await service.resolveFromRequest(verified.req);
    expect(resolved?.id).toBe('t-3');
  });

  it('does NOT fall back to x-tenant-slug when x-tenant-host is an explicit reserved platform subdomain', async () => {
    for (const subdomain of ['admin', 'panel', 'api', 'auth', 'www']) {
      const ctx = createHttpContext({
        'x-tenant-host': `${subdomain}.localhost:3000`,
        'x-tenant-slug': 'moda-mayorista',
      });
      await expect(service.resolveFromRequest(ctx.req)).resolves.toBeNull();
      expect(ctx.req.tenant).toBeUndefined();
      expect(mockPrisma.tenant.findUnique).not.toHaveBeenCalled();
    }
  });

  it('invalidates tenant slug, subdomain host, and custom domain cache keys via invalidateTenantCache', async () => {
    await service.invalidateTenantCache('Moda-Mayorista', [
      'shop.ejemplo.com:8443',
      'moda-mayorista.localhost:3000',
    ]);

    expect(mockRedis.del).toHaveBeenCalledWith('tenant:slug:moda-mayorista');
    expect(mockRedis.del).toHaveBeenCalledWith('tenant:host:moda-mayorista.localhost');
    expect(mockRedis.del).toHaveBeenCalledWith('tenant:host:shop.ejemplo.com');
    expect(mockRedis.del).toHaveBeenCalledTimes(3);
  });
});
