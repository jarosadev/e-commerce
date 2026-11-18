import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PlatformRole } from '@prisma/client';
import type { Response } from 'express';
import { RequestWithContext } from '../../common/cls/cls.types';
import { EnvConfig } from '../../config/env.validation';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.module';
import { AuthService } from './auth.service';
import { GoogleOAuthService } from './google-oauth.service';

describe('GoogleOAuthService', () => {
  let service: GoogleOAuthService;
  let envMap: Record<string, unknown>;
  let prisma: {
    tenant: { findUnique: jest.Mock };
    customDomain: { findUnique: jest.Mock };
    platformUser: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    forTenant: jest.Mock;
  };
  let redis: { setJson: jest.Mock; getDel: jest.Mock };
  let jwtService: { signAsync: jest.Mock; verifyAsync: jest.Mock };
  let authService: {
    issuePlatformSession: jest.Mock;
    issueStoreCustomerSession: jest.Mock;
  };

  beforeEach(() => {
    envMap = {
      FRONTEND_URL: 'http://localhost:3000',
      PLATFORM_BASE_DOMAIN: 'localhost:3000',
      GOOGLE_CLIENT_ID: 'your-google-client-id.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'your-google-client-secret',
      GOOGLE_CALLBACK_URL: 'http://localhost:4000/api/v1/auth/google/callback',
      OAUTH_STATE_SECRET: 'test_oauth_state_secret_1234567890',
    };

    const config = {
      get: jest.fn((key: string) => envMap[key]),
    } as unknown as ConfigService<EnvConfig, true>;

    prisma = {
      tenant: { findUnique: jest.fn() },
      customDomain: { findUnique: jest.fn().mockResolvedValue(null) },
      platformUser: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      forTenant: jest.fn(),
    };

    redis = {
      setJson: jest.fn().mockResolvedValue(undefined),
      getDel: jest.fn().mockResolvedValue(null),
    };

    jwtService = {
      signAsync: jest.fn().mockResolvedValue('signed-state-jwt'),
      verifyAsync: jest.fn(),
    };

    authService = {
      issuePlatformSession: jest.fn(),
      issueStoreCustomerSession: jest.fn(),
    };

    service = new GoogleOAuthService(
      config,
      jwtService as unknown as JwtService,
      prisma as unknown as PrismaService,
      redis as unknown as RedisService,
      authService as unknown as AuthService,
    );
  });

  it('reports local-fallback when Google credentials are placeholders', () => {
    expect(service.getCapabilities()).toEqual({
      googleEnabled: false,
      mode: 'local-fallback',
    });
  });

  it('redirects to local-fallback URL (never accounts.google.com) when Google is not configured', async () => {
    const url = await service.buildAuthorizationOrFallbackUrl({
      scope: 'platform',
      returnHost: 'localhost:3000',
    });

    expect(url).toBe('http://localhost:3000/login?oauth=unavailable&mode=local-fallback');
    expect(url).not.toContain('accounts.google.com');
  });

  it('rejects untrusted or malformed returnHost to prevent open redirects', async () => {
    for (const badHost of [
      'evil-phishing.example.com',
      '.localhost:3000',
      'localhost:abc',
      'localhost:3000.evil.com',
      'sub.moda-mayorista.localhost:3000',
    ]) {
      await expect(
        service.buildAuthorizationOrFallbackUrl({
          scope: 'platform',
          returnHost: badHost,
        }),
      ).rejects.toThrow(BadRequestException);
    }

    const validSubUrl = await service.buildAuthorizationOrFallbackUrl({
      scope: 'platform',
      returnHost: 'moda-mayorista.localhost:3000',
    });
    expect(validSubUrl).toBe(
      'http://moda-mayorista.localhost:3000/login?oauth=unavailable&mode=local-fallback',
    );
  });

  it('builds accounts.google.com redirect URL with Redis state when Google is configured', async () => {
    envMap.GOOGLE_CLIENT_ID = 'real-google-client-id-12345';
    envMap.GOOGLE_CLIENT_SECRET = 'real-google-client-secret-12345';

    expect(service.getCapabilities()).toEqual({
      googleEnabled: true,
      mode: 'oauth',
    });

    const url = await service.buildAuthorizationOrFallbackUrl({
      scope: 'platform',
      returnHost: 'localhost:3000',
    });

    expect(url).toContain('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url).toContain('state=signed-state-jwt');
    expect(redis.setJson).toHaveBeenCalledWith(
      expect.stringMatching(/^auth:oauth:state:/),
      expect.objectContaining({ scope: 'platform', returnOrigin: 'http://localhost:3000' }),
      300,
    );
  });

  it('atomically consumes one-time exchange code and rejects invalid/replayed codes with 401', async () => {
    redis.getDel.mockResolvedValueOnce(null);
    const req = { cookies: {}, headers: {} } as unknown as RequestWithContext;
    const res = {} as Response;

    await expect(service.exchangeOneTimeCode({ code: 'invalid-code' }, req, res)).rejects.toThrow(
      UnauthorizedException,
    );

    redis.getDel.mockResolvedValueOnce(
      JSON.stringify({
        actorType: 'PLATFORM',
        userId: 'user-1',
      }),
    );
    prisma.platformUser.findUnique.mockResolvedValueOnce({
      id: 'user-1',
      email: 'oauth@test.com',
      fullName: 'OAuth User',
      role: PlatformRole.STORE_OWNER,
      isActive: true,
      ownedTenants: [],
    });
    authService.issuePlatformSession.mockResolvedValueOnce({
      id: 'user-1',
      email: 'oauth@test.com',
      fullName: 'OAuth User',
      role: PlatformRole.STORE_OWNER,
      actorType: 'PLATFORM',
    });

    const session = await service.exchangeOneTimeCode({ code: 'valid-once' }, req, res);
    expect(session.user.email).toBe('oauth@test.com');
    expect(authService.issuePlatformSession).toHaveBeenCalledTimes(1);
  });
});
