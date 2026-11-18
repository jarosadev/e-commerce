import { ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { CustomerTier, PlatformRole, TenantStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import type { Response } from 'express';
import { RequestWithContext, ResolvedTenantContext } from '../../common/cls/cls.types';
import { EnvConfig } from '../../config/env.validation';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.module';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthService } from './auth.service';
import { GUEST_CART_MERGER, GuestCartMerger } from './interfaces/guest-cart-merger.interface';

function createMockResponse(): Response {
  const cookies: Record<string, unknown> = {};
  return {
    cookie: jest.fn((name: string, value: string, opts: unknown) => {
      cookies[name] = { value, opts };
    }),
    clearCookie: jest.fn((name: string) => {
      delete cookies[name];
    }),
  } as unknown as Response;
}

describe('AuthService', () => {
  let service: AuthService;
  let prisma: {
    platformUser: Record<string, jest.Mock>;
    platformRefreshToken: Record<string, jest.Mock>;
    tenant: Record<string, jest.Mock>;
    forTenant: jest.Mock;
    $transaction: jest.Mock;
  };
  let tenantDb: {
    storeCustomer: Record<string, jest.Mock>;
    customerRefreshToken: Record<string, jest.Mock>;
    $transaction: jest.Mock;
  };
  let redisStore: Map<string, string>;
  let redis: {
    setJson: jest.Mock;
    getJson: jest.Mock;
    del: jest.Mock;
    incrWithTtl: jest.Mock;
  };
  let jwtService: { signAsync: jest.Mock; verifyAsync: jest.Mock };
  let notificationsService: {
    sendOtpVerification: jest.Mock;
    sendPasswordResetOtp: jest.Mock;
  };
  let moduleRef: { get: jest.Mock };
  let config: ConfigService<EnvConfig, true>;

  const tenantCtx: ResolvedTenantContext = {
    id: 'tenant-1',
    slug: 'moda-mayorista',
    name: 'Moda Mayorista',
    status: TenantStatus.ACTIVE,
    currency: 'USD',
    ownerId: 'owner-1',
  };

  beforeEach(() => {
    redisStore = new Map();
    const attemptsMap = new Map<string, number>();

    tenantDb = {
      storeCustomer: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      customerRefreshToken: {
        findUnique: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn(async (cb: (tx: typeof tenantDb) => Promise<unknown>) => cb(tenantDb)),
    };

    prisma = {
      platformUser: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      platformRefreshToken: {
        findUnique: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn(),
      },
      tenant: {
        findUnique: jest.fn(),
      },
      forTenant: jest.fn(() => tenantDb),
      $transaction: jest.fn(async (cb: (tx: typeof prisma) => Promise<unknown>) => cb(prisma)),
    };

    redis = {
      setJson: jest.fn(async (key: string, val: unknown) => {
        redisStore.set(key, JSON.stringify(val));
      }),
      getJson: jest.fn(async (key: string) => {
        const raw = redisStore.get(key);
        return raw ? JSON.parse(raw) : null;
      }),
      del: jest.fn(async (key: string) => {
        redisStore.delete(key);
        attemptsMap.delete(key);
      }),
      incrWithTtl: jest.fn(async (key: string) => {
        const next = (attemptsMap.get(key) ?? 0) + 1;
        attemptsMap.set(key, next);
        return next;
      }),
    };

    let jwtCounter = 0;
    jwtService = {
      signAsync: jest.fn(async (payload: Record<string, unknown>) => {
        jwtCounter += 1;
        return `jwt.${jwtCounter}.${String(payload.sub ?? '')}`;
      }),
      verifyAsync: jest.fn(),
    };

    notificationsService = {
      sendOtpVerification: jest.fn().mockResolvedValue('job-otp-1'),
      sendPasswordResetOtp: jest.fn().mockResolvedValue('job-reset-1'),
    };

    moduleRef = {
      get: jest.fn(() => {
        throw new Error('Not registered');
      }),
    };

    config = {
      get: jest.fn((key: string) => {
        const map: Record<string, unknown> = {
          NODE_ENV: 'test',
          JWT_ACCESS_SECRET: 'test_access_secret_1234567890',
          JWT_REFRESH_SECRET: 'test_refresh_secret_1234567890',
          OAUTH_STATE_SECRET: 'test_oauth_state_secret_1234567890',
          JWT_ACCESS_TTL: '15m',
          JWT_REFRESH_TTL_DAYS: 30,
        };
        return map[key];
      }),
    } as unknown as ConfigService<EnvConfig, true>;

    service = new AuthService(
      prisma as unknown as PrismaService,
      redis as unknown as RedisService,
      jwtService as unknown as JwtService,
      config,
      notificationsService as unknown as NotificationsService,
      moduleRef as unknown as ModuleRef,
    );
    service.onModuleInit();
  });

  it('registers PlatformUser with Argon2id hash, STORE_OWNER role, and dispatches 6-digit OTP', async () => {
    prisma.platformUser.findUnique.mockResolvedValue(null);
    prisma.platformUser.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'user-1',
        email: data.email,
        passwordHash: data.passwordHash,
        fullName: data.fullName,
        role: data.role,
        avatarUrl: null,
        isActive: true,
        emailVerifiedAt: null,
      }),
    );

    const result = await service.registerPlatform({
      email: ' Owner@Test.COM ',
      password: 'Password123!',
      fullName: 'Owner Test',
    });

    expect(result.email).toBe('owner@test.com');
    expect(result.role).toBe(PlatformRole.STORE_OWNER);
    expect(result.actorType).toBe('PLATFORM');
    expect((result as unknown as Record<string, unknown>).passwordHash).toBeUndefined();

    const createArg = prisma.platformUser.create.mock.calls[0][0].data;
    expect(String(createArg.passwordHash)).toMatch(/^\$argon2id\$/);
    await expect(argon2.verify(String(createArg.passwordHash), 'Password123!')).resolves.toBe(true);

    expect(notificationsService.sendOtpVerification).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'owner@test.com',
        otpCode: expect.stringMatching(/^\d{6}$/),
        expiresInMinutes: 15,
      }),
    );
  });

  it('invalidates OTP after 5 failed verification attempts and rejects valid code afterwards', async () => {
    prisma.platformUser.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'owner@test.com',
      fullName: 'Owner',
      isActive: true,
      emailVerifiedAt: null,
    });
    prisma.platformUser.create.mockResolvedValue({
      id: 'user-1',
      email: 'owner@test.com',
      fullName: 'Owner',
      role: PlatformRole.STORE_OWNER,
      avatarUrl: null,
      emailVerifiedAt: null,
    });

    // Register when user does not exist yet
    prisma.platformUser.findUnique.mockResolvedValueOnce(null);
    await service.registerPlatform({
      email: 'owner@test.com',
      password: 'Password123!',
      fullName: 'Owner',
    });

    const sentOtp = notificationsService.sendOtpVerification.mock.calls[0][0].otpCode as string;
    const wrongOtp = sentOtp === '000000' ? '111111' : '000000';

    for (let i = 0; i < 5; i += 1) {
      await expect(
        service.verifyPlatformOtp({ email: 'owner@test.com', otp: wrongOtp }),
      ).rejects.toThrow(UnauthorizedException);
    }

    // 6th attempt even with real OTP fails because OTP key was deleted after 5 attempts
    await expect(
      service.verifyPlatformOtp({ email: 'owner@test.com', otp: sentOtp }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('prevents unverified platform user from logging in with 403 EMAIL_NOT_VERIFIED', async () => {
    const hash = await argon2.hash('Password123!', { type: argon2.argon2id });
    prisma.platformUser.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'owner@test.com',
      passwordHash: hash,
      fullName: 'Owner',
      role: PlatformRole.STORE_OWNER,
      isActive: true,
      emailVerifiedAt: null,
    });

    const res = createMockResponse();
    await expect(
      service.loginPlatform({ email: 'owner@test.com', password: 'Password123!' }, res),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rotates refresh token and revokes entire familyId upon reuse detection', async () => {
    const user = {
      id: 'user-1',
      email: 'owner@test.com',
      fullName: 'Owner',
      role: PlatformRole.STORE_OWNER,
      avatarUrl: null,
      isActive: true,
      emailVerifiedAt: new Date(),
      ownedTenants: [],
    };

    jwtService.verifyAsync.mockResolvedValue({
      jti: 'tok-1',
      sub: 'user-1',
      familyId: 'fam-1',
      actorType: 'PLATFORM',
    });

    prisma.platformRefreshToken.findUnique.mockResolvedValue({
      id: 'tok-1',
      userId: 'user-1',
      familyId: 'fam-1',
      revokedAt: new Date(), // already revoked -> REUSE!
      expiresAt: new Date(Date.now() + 60_000),
      user,
    });

    const req = {
      cookies: { refresh_token: 'reused-raw-token' },
      headers: {},
    } as unknown as RequestWithContext;
    const res = createMockResponse();

    await expect(service.refreshTokens(req, res)).rejects.toThrow(UnauthorizedException);

    expect(prisma.platformRefreshToken.updateMany).toHaveBeenCalledWith({
      where: { familyId: 'fam-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(res.clearCookie).toHaveBeenCalledWith('access_token', expect.any(Object));
    expect(res.clearCookie).toHaveBeenCalledWith('refresh_token', expect.any(Object));
  });

  it('enforces per-tenant StoreCustomer uniqueness (409) and calls optional guestCartMerger on login', async () => {
    const mockMerger: GuestCartMerger = {
      mergeGuestCartOnLogin: jest.fn().mockResolvedValue(undefined),
    };
    moduleRef.get.mockImplementation((token: unknown) => {
      if (token === GUEST_CART_MERGER) return mockMerger;
      throw new Error('Not found');
    });
    service.onModuleInit();

    tenantDb.storeCustomer.findUnique.mockResolvedValueOnce({ id: 'existing' });
    await expect(
      service.registerStoreCustomer(tenantCtx, {
        email: 'buyer@test.com',
        password: 'BuyerPass123!',
        fullName: 'Buyer',
      }),
    ).rejects.toThrow(ConflictException);

    const hash = await argon2.hash('BuyerPass123!', { type: argon2.argon2id });
    tenantDb.storeCustomer.findUnique.mockResolvedValueOnce({
      id: 'cust-1',
      tenantId: tenantCtx.id,
      email: 'buyer@test.com',
      passwordHash: hash,
      fullName: 'Buyer',
      customerTier: CustomerTier.RETAIL,
      emailVerifiedAt: new Date(),
    });

    const req = {
      cookies: { guest_cart_token: 'guest-tok-999' },
      headers: {},
    } as unknown as RequestWithContext;
    const res = createMockResponse();

    const session = await service.loginStoreCustomer(
      tenantCtx,
      { email: 'buyer@test.com', password: 'BuyerPass123!' },
      req,
      res,
    );

    expect(session.user.actorType).toBe('CUSTOMER');
    expect(session.user.role).toBe('CUSTOMER');
    expect(session.user.tenantId).toBe(tenantCtx.id);
    expect(jwtService.signAsync).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        sub: 'cust-1',
        actorType: 'CUSTOMER',
        role: 'CUSTOMER',
        tenantId: tenantCtx.id,
      }),
    );
    expect(mockMerger.mergeGuestCartOnLogin).toHaveBeenCalledWith({
      tenantId: tenantCtx.id,
      customerId: 'cust-1',
      guestToken: 'guest-tok-999',
    });
  });

  it('logout revokes token family and clears access_token and refresh_token cookies', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      jti: 'tok-1',
      sub: 'user-1',
      familyId: 'fam-logout',
      actorType: 'PLATFORM',
    });

    const req = {
      cookies: { refresh_token: 'valid-refresh' },
      headers: {},
    } as unknown as RequestWithContext;
    const res = createMockResponse();

    const result = await service.logout(req, res);
    expect(result).toEqual({ loggedOut: true });
    expect(prisma.platformRefreshToken.updateMany).toHaveBeenCalledWith({
      where: { familyId: 'fam-logout', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(res.clearCookie).toHaveBeenCalledWith('access_token', expect.any(Object));
    expect(res.clearCookie).toHaveBeenCalledWith('refresh_token', expect.any(Object));
  });

  it('atomically revokes old token and creates R_next inside $transaction on platform refresh', async () => {
    const user = {
      id: 'user-1',
      email: 'owner@test.com',
      fullName: 'Owner',
      role: PlatformRole.STORE_OWNER,
      avatarUrl: null,
      isActive: true,
      emailVerifiedAt: new Date(),
      ownedTenants: [],
    };

    jwtService.verifyAsync.mockResolvedValue({
      jti: 'tok-1',
      sub: 'user-1',
      familyId: 'fam-atomic',
      actorType: 'PLATFORM',
    });

    prisma.platformRefreshToken.findUnique.mockResolvedValue({
      id: 'tok-1',
      userId: 'user-1',
      familyId: 'fam-atomic',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      user,
    });
    prisma.platformRefreshToken.updateMany.mockResolvedValueOnce({ count: 1 });
    prisma.platformRefreshToken.create.mockResolvedValueOnce({ id: 'tok-2' });

    const req = {
      cookies: { refresh_token: 'valid-r1' },
      headers: { 'user-agent': 'jest-agent' },
      ip: '127.0.0.1',
    } as unknown as RequestWithContext;
    const res = createMockResponse();

    const session = await service.refreshTokens(req, res);
    expect(session.user.email).toBe('owner@test.com');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.platformRefreshToken.updateMany).toHaveBeenCalledWith({
      where: { id: 'tok-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(prisma.platformRefreshToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        familyId: 'fam-atomic',
        userAgent: 'jest-agent',
        ipAddress: '127.0.0.1',
      }),
    });
    expect(res.cookie).toHaveBeenCalledWith('access_token', expect.any(String), expect.any(Object));
    expect(res.cookie).toHaveBeenCalledWith(
      'refresh_token',
      expect.any(String),
      expect.any(Object),
    );
  });

  it('revokes entire family without creating R_next when concurrent race loses $transaction updateMany', async () => {
    const user = {
      id: 'user-1',
      email: 'owner@test.com',
      fullName: 'Owner',
      role: PlatformRole.STORE_OWNER,
      avatarUrl: null,
      isActive: true,
      emailVerifiedAt: new Date(),
      ownedTenants: [],
    };

    jwtService.verifyAsync.mockResolvedValue({
      jti: 'tok-1',
      sub: 'user-1',
      familyId: 'fam-race',
      actorType: 'PLATFORM',
    });

    prisma.platformRefreshToken.findUnique.mockResolvedValue({
      id: 'tok-1',
      userId: 'user-1',
      familyId: 'fam-race',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      user,
    });
    // Another concurrent transaction already consumed tok-1
    prisma.platformRefreshToken.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });

    const req = {
      cookies: { refresh_token: 'raced-r1' },
      headers: {},
    } as unknown as RequestWithContext;
    const res = createMockResponse();

    await expect(service.refreshTokens(req, res)).rejects.toThrow(UnauthorizedException);
    expect(prisma.platformRefreshToken.create).not.toHaveBeenCalled();
    expect(prisma.platformRefreshToken.updateMany).toHaveBeenLastCalledWith({
      where: { familyId: 'fam-race', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(res.clearCookie).toHaveBeenCalledWith('access_token', expect.any(Object));
    expect(res.clearCookie).toHaveBeenCalledWith('refresh_token', expect.any(Object));
  });

  it('atomically rotates CUSTOMER refresh token inside tenantDb.$transaction and revokes family on race loss', async () => {
    const customer = {
      id: 'cust-1',
      tenantId: 'tenant-1',
      email: 'buyer@test.com',
      fullName: 'Buyer',
      customerTier: CustomerTier.RETAIL,
      emailVerifiedAt: new Date(),
    };

    jwtService.verifyAsync.mockResolvedValue({
      jti: 'ctok-1',
      sub: 'cust-1',
      familyId: 'cfam-1',
      actorType: 'CUSTOMER',
      tenantId: 'tenant-1',
    });
    prisma.tenant.findUnique.mockResolvedValue({
      id: 'tenant-1',
      status: TenantStatus.ACTIVE,
    });
    tenantDb.customerRefreshToken.findUnique.mockResolvedValue({
      id: 'ctok-1',
      tenantId: 'tenant-1',
      customerId: 'cust-1',
      familyId: 'cfam-1',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      customer,
    });
    tenantDb.customerRefreshToken.updateMany.mockResolvedValueOnce({ count: 1 });
    tenantDb.customerRefreshToken.create.mockResolvedValueOnce({ id: 'ctok-2' });

    const req = {
      cookies: { refresh_token: 'cust-r1' },
      headers: {},
    } as unknown as RequestWithContext;
    const res = createMockResponse();

    const session = await service.refreshTokens(req, res);
    expect(session.user.actorType).toBe('CUSTOMER');
    expect(tenantDb.$transaction).toHaveBeenCalledTimes(1);
    expect(tenantDb.customerRefreshToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'tenant-1',
        customerId: 'cust-1',
        familyId: 'cfam-1',
      }),
    });

    // Now simulate concurrent race loss (count === 0)
    tenantDb.customerRefreshToken.create.mockClear();
    tenantDb.customerRefreshToken.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });

    await expect(service.refreshTokens(req, res)).rejects.toThrow(UnauthorizedException);
    expect(tenantDb.customerRefreshToken.create).not.toHaveBeenCalled();
    expect(tenantDb.customerRefreshToken.updateMany).toHaveBeenLastCalledWith({
      where: { familyId: 'cfam-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('blocks GET /auth/me with 403 TENANT_SUSPENDED when CUSTOMER tenant is suspended', async () => {
    prisma.tenant.findUnique.mockResolvedValueOnce({
      id: 'tenant-susp',
      status: TenantStatus.SUSPENDED,
    });

    await expect(
      service.getMe({
        sub: 'cust-1',
        email: 'buyer@test.com',
        actorType: 'CUSTOMER',
        role: 'CUSTOMER',
        tenantId: 'tenant-susp',
        fullName: 'Buyer',
      }),
    ).rejects.toThrow(ForbiddenException);

    expect(tenantDb.storeCustomer.findUnique).not.toHaveBeenCalled();

    prisma.tenant.findUnique.mockResolvedValueOnce({
      id: 'tenant-1',
      status: TenantStatus.ACTIVE,
    });
    tenantDb.storeCustomer.findUnique.mockResolvedValueOnce({
      id: 'cust-1',
      tenantId: 'tenant-1',
      email: 'buyer@test.com',
      fullName: 'Buyer',
      customerTier: CustomerTier.RETAIL,
      emailVerifiedAt: new Date(),
    });

    const activeResult = await service.getMe({
      sub: 'cust-1',
      email: 'buyer@test.com',
      actorType: 'CUSTOMER',
      role: 'CUSTOMER',
      tenantId: 'tenant-1',
      fullName: 'Buyer',
    });
    expect(activeResult.email).toBe('buyer@test.com');
  });
});
