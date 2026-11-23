import {
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PlatformRole, TenantStatus } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { EnvConfig } from '../../config/env.validation';
import { CLS_TENANT_ID, CLS_USER } from '../cls/cls.constants';
import { AppClsStore, RequestWithContext, ResolvedTenantContext } from '../cls/cls.types';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { IS_OPTIONAL_AUTH_KEY } from '../decorators/optional-auth.decorator';
import { REQUIRE_TENANT_KEY, SKIP_TENANT_STATUS_KEY } from '../decorators/require-tenant.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { TenantResolutionService } from '../services/tenant-resolution.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { TenantStatusGuard } from './tenant-status.guard';

describe('Common Guards', () => {
  function buildExecutionContext(req: Partial<RequestWithContext>): ExecutionContext {
    return {
      getType: () => 'http',
      getHandler: () => (() => undefined) as never,
      getClass: () => class Dummy {} as never,
      switchToHttp: () => ({
        getRequest: () => req,
      }),
    } as unknown as ExecutionContext;
  }

  describe('JwtAuthGuard', () => {
    let reflector: Reflector;
    let jwtService: JwtService;
    let clsMap: Map<string, unknown>;
    let resolutionService: { resolveFromRequest: jest.Mock };
    let guard: JwtAuthGuard;

    beforeEach(() => {
      reflector = new Reflector();
      jwtService = new JwtService({ secret: 'test-secret' });
      clsMap = new Map();
      const cls = {
        isActive: () => true,
        get: (k: string) => clsMap.get(k),
        set: (k: string, v: unknown) => clsMap.set(k, v),
      } as unknown as ClsService<AppClsStore>;
      const config = {
        get: () => 'test-secret',
      } as unknown as ConfigService<EnvConfig, true>;
      resolutionService = {
        resolveFromRequest: jest.fn().mockResolvedValue(null),
      };

      guard = new JwtAuthGuard(
        reflector,
        jwtService,
        config,
        cls,
        resolutionService as unknown as TenantResolutionService,
      );
    });

    it('bypasses @Public() routes', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => key === IS_PUBLIC_KEY);
      await expect(
        guard.canActivate(buildExecutionContext({ headers: {}, cookies: {} })),
      ).resolves.toBe(true);
    });

    it('bypasses when @OptionalAuth() is set and token is missing', async () => {
      jest
        .spyOn(reflector, 'getAllAndOverride')
        .mockImplementation((key) => key === IS_OPTIONAL_AUTH_KEY);
      await expect(
        guard.canActivate(buildExecutionContext({ headers: {}, cookies: {} })),
      ).resolves.toBe(true);
    });

    it('throws UnauthorizedException when token is missing', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
      await expect(
        guard.canActivate(buildExecutionContext({ headers: {}, cookies: {} })),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('authenticates Bearer token and cookie access_token, and rejects cross-tenant customer token', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
      const token = await jwtService.signAsync({
        sub: 'cust-1',
        email: 'buyer@test.local',
        actorType: 'CUSTOMER',
        role: 'CUSTOMER',
        tenantId: 'tenant-1',
      });

      const reqOk = {
        headers: { authorization: `Bearer ${token}` },
        cookies: {},
        tenantId: 'tenant-1',
      } as unknown as RequestWithContext;
      await expect(guard.canActivate(buildExecutionContext(reqOk))).resolves.toBe(true);
      expect(reqOk.user?.sub).toBe('cust-1');
      expect(clsMap.get(CLS_USER)).toEqual(expect.objectContaining({ sub: 'cust-1' }));

      const reqCookie = {
        headers: {},
        cookies: { access_token: token },
      } as unknown as RequestWithContext;
      await expect(guard.canActivate(buildExecutionContext(reqCookie))).resolves.toBe(true);

      clsMap.set(CLS_TENANT_ID, 'tenant-2');
      const reqCrossTenant = {
        headers: { authorization: `Bearer ${token}` },
        cookies: {},
        tenantId: 'tenant-2',
      } as unknown as RequestWithContext;
      await expect(guard.canActivate(buildExecutionContext(reqCrossTenant))).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('pre-resolves tenant from request before validating CUSTOMER JWT without pre-set CLS/req.tenantId', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
      const token = await jwtService.signAsync({
        sub: 'cust-1',
        email: 'buyer@test.local',
        actorType: 'CUSTOMER',
        role: 'CUSTOMER',
        tenantId: 'tenant-1',
      });

      resolutionService.resolveFromRequest.mockResolvedValueOnce({
        id: 'tenant-1',
        slug: 'store-1',
        name: 'Store 1',
        status: TenantStatus.ACTIVE,
        currency: 'USD',
        ownerId: 'owner-1',
      });
      const reqSameTenant = {
        headers: {
          authorization: `Bearer ${token}`,
          'x-tenant-host': 'store-1.localhost:3000',
        },
        cookies: {},
      } as unknown as RequestWithContext;
      await expect(guard.canActivate(buildExecutionContext(reqSameTenant))).resolves.toBe(true);
      expect(resolutionService.resolveFromRequest).toHaveBeenCalledWith(reqSameTenant);

      resolutionService.resolveFromRequest.mockResolvedValueOnce({
        id: 'tenant-2',
        slug: 'store-2',
        name: 'Store 2',
        status: TenantStatus.ACTIVE,
        currency: 'USD',
        ownerId: 'owner-2',
      });
      const reqWrongTenantBearer = {
        headers: {
          authorization: `Bearer ${token}`,
          'x-tenant-host': 'store-2.localhost:3000',
        },
        cookies: {},
      } as unknown as RequestWithContext;
      await expect(guard.canActivate(buildExecutionContext(reqWrongTenantBearer))).rejects.toThrow(
        UnauthorizedException,
      );

      resolutionService.resolveFromRequest.mockResolvedValueOnce({
        id: 'tenant-2',
        slug: 'store-2',
        name: 'Store 2',
        status: TenantStatus.ACTIVE,
        currency: 'USD',
        ownerId: 'owner-2',
      });
      const reqWrongTenantCookie = {
        headers: {
          'x-tenant-host': 'store-2.localhost:3000',
        },
        cookies: { access_token: token },
      } as unknown as RequestWithContext;
      await expect(guard.canActivate(buildExecutionContext(reqWrongTenantCookie))).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('RolesGuard', () => {
    it('allows matching role and throws ForbiddenException otherwise', () => {
      const reflector = new Reflector();
      const guard = new RolesGuard(reflector);

      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValueOnce(undefined);
      expect(guard.canActivate(buildExecutionContext({}))).toBe(true);

      jest
        .spyOn(reflector, 'getAllAndOverride')
        .mockImplementation((key) => (key === ROLES_KEY ? [PlatformRole.SUPER_ADMIN] : undefined));

      expect(
        guard.canActivate(
          buildExecutionContext({
            user: {
              sub: 'admin-1',
              email: 'admin@vendexa.local',
              actorType: 'PLATFORM',
              role: PlatformRole.SUPER_ADMIN,
            },
          }),
        ),
      ).toBe(true);

      expect(() =>
        guard.canActivate(
          buildExecutionContext({
            user: {
              sub: 'owner-1',
              email: 'owner@store.local',
              actorType: 'PLATFORM',
              role: PlatformRole.STORE_OWNER,
            },
          }),
        ),
      ).toThrow(ForbiddenException);
    });
  });

  describe('TenantStatusGuard', () => {
    let reflector: Reflector;
    let resolutionService: { resolveFromRequest: jest.Mock };
    let guard: TenantStatusGuard;

    beforeEach(() => {
      reflector = new Reflector();
      resolutionService = { resolveFromRequest: jest.fn() };
      guard = new TenantStatusGuard(
        reflector,
        resolutionService as unknown as TenantResolutionService,
      );
    });

    it('skips when @SkipTenantStatus() is set and enforces @RequireTenant()', async () => {
      jest
        .spyOn(reflector, 'getAllAndOverride')
        .mockImplementation((key) => key === SKIP_TENANT_STATUS_KEY);
      await expect(guard.canActivate(buildExecutionContext({}))).resolves.toBe(true);
      expect(resolutionService.resolveFromRequest).not.toHaveBeenCalled();

      jest
        .spyOn(reflector, 'getAllAndOverride')
        .mockImplementation((key) => key === REQUIRE_TENANT_KEY);
      resolutionService.resolveFromRequest.mockResolvedValueOnce(null);
      await expect(guard.canActivate(buildExecutionContext({ headers: {} }))).rejects.toThrow(
        NotFoundException,
      );
    });

    it('allows TRIAL/ACTIVE/PAST_DUE, blocks SUSPENDED for non-superadmin, allows SUPER_ADMIN', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

      const baseTenant: ResolvedTenantContext = {
        id: 't-1',
        slug: 'moda',
        name: 'Moda',
        status: TenantStatus.TRIAL,
        currency: 'USD',
        ownerId: 'u-1',
      };

      for (const status of [TenantStatus.TRIAL, TenantStatus.ACTIVE, TenantStatus.PAST_DUE]) {
        resolutionService.resolveFromRequest.mockResolvedValueOnce({ ...baseTenant, status });
        await expect(guard.canActivate(buildExecutionContext({ headers: {} }))).resolves.toBe(true);
      }

      resolutionService.resolveFromRequest.mockResolvedValueOnce({
        ...baseTenant,
        status: TenantStatus.SUSPENDED,
      });
      await expect(guard.canActivate(buildExecutionContext({ headers: {} }))).rejects.toThrow(
        ForbiddenException,
      );

      resolutionService.resolveFromRequest.mockResolvedValueOnce({
        ...baseTenant,
        status: TenantStatus.SUSPENDED,
      });
      await expect(
        guard.canActivate(
          buildExecutionContext({
            headers: {},
            user: {
              sub: 'admin-1',
              email: 'admin@vendexa.local',
              actorType: 'PLATFORM',
              role: PlatformRole.SUPER_ADMIN,
            },
          }),
        ),
      ).resolves.toBe(true);
    });
  });
});
