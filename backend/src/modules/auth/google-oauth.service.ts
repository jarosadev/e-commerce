import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { CustomerTier, PlatformRole, TenantStatus } from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'crypto';
import type { Response } from 'express';
import { EnvConfig, isGoogleOAuthConfigured } from '../../config/env.validation';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.module';
import { RequestWithContext } from '../../common/cls/cls.types';
import { AuthService, RequestSessionMeta } from './auth.service';
import {
  GoogleAuthQueryDto,
  GoogleCallbackQueryDto,
  GoogleExchangeDto,
} from './dto/auth-requests.dto';
import { AuthCapabilitiesResponseDto, AuthSessionResponseDto } from './dto/auth-responses.dto';

const OAUTH_STATE_TTL_SECONDS = 300; // 5 minutes
const OAUTH_EXCHANGE_CODE_TTL_SECONDS = 30; // 30 seconds

interface SignedOAuthStateJwt {
  nonce: string;
  scope: 'platform' | 'store';
  tenantId?: string;
}

interface StoredOAuthStatePayload {
  scope: 'platform' | 'store';
  returnOrigin: string;
  tenantId?: string;
  tenantSlug?: string;
  guestCartToken?: string;
}

interface StoredOAuthExchangePayload {
  actorType: 'PLATFORM' | 'CUSTOMER';
  userId: string;
  tenantId?: string;
  guestCartToken?: string;
}

interface GoogleTokenResponse {
  access_token?: string;
  id_token?: string;
  error?: string;
}

interface GoogleUserInfoResponse {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

@Injectable()
export class GoogleOAuthService {
  private readonly logger = new Logger(GoogleOAuthService.name);
  private readonly baseHostname: string;
  private readonly frontendUrl: string;
  private readonly frontendHost: string;
  private readonly frontendProtocol: string;

  constructor(
    private readonly config: ConfigService<EnvConfig, true>,
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly authService: AuthService,
  ) {
    this.frontendUrl = this.config.get('FRONTEND_URL', { infer: true }).replace(/\/+$/, '');
    const parsedFrontend = new URL(this.frontendUrl);
    this.frontendHost = parsedFrontend.host.toLowerCase();
    this.frontendProtocol = parsedFrontend.protocol;

    const rawBaseDomain = this.config.get('PLATFORM_BASE_DOMAIN', { infer: true });
    this.baseHostname = rawBaseDomain.split(':')[0].trim().toLowerCase() || 'localhost';
  }

  getCapabilities(): AuthCapabilitiesResponseDto {
    const googleEnabled = isGoogleOAuthConfigured({
      GOOGLE_CLIENT_ID: this.config.get('GOOGLE_CLIENT_ID', { infer: true }),
      GOOGLE_CLIENT_SECRET: this.config.get('GOOGLE_CLIENT_SECRET', { infer: true }),
    });
    return {
      googleEnabled,
      mode: googleEnabled ? 'oauth' : 'local-fallback',
    };
  }

  async buildAuthorizationOrFallbackUrl(query: GoogleAuthQueryDto): Promise<string> {
    const returnOrigin = await this.resolveTrustedReturnOrigin(query.returnHost);
    const scope = query.scope ?? 'platform';
    let tenantId: string | undefined;
    let tenantSlug: string | undefined;

    if (scope === 'store') {
      const candidateSlug =
        query.tenantSlug?.trim().toLowerCase() ||
        this.extractSubdomainSlugFromHost(query.returnHost);

      if (!candidateSlug) {
        throw new BadRequestException('Se requiere tenantSlug para iniciar sesión en tienda.');
      }

      const tenant = await this.prisma.tenant.findUnique({
        where: { slug: candidateSlug },
        select: { id: true, slug: true, status: true },
      });

      if (!tenant) {
        throw new NotFoundException('Tienda no encontrada o dominio no configurado.');
      }

      if (tenant.status === TenantStatus.SUSPENDED) {
        throw new ForbiddenException({
          message: 'La tienda se encuentra suspendida temporalmente.',
          code: 'TENANT_SUSPENDED',
        });
      }

      tenantId = tenant.id;
      tenantSlug = tenant.slug;
    }

    const capabilities = this.getCapabilities();
    if (!capabilities.googleEnabled) {
      return `${returnOrigin}/login?oauth=unavailable&mode=local-fallback`;
    }

    const nonce = randomUUID();
    const statePayload: StoredOAuthStatePayload = {
      scope,
      returnOrigin,
      tenantId,
      tenantSlug,
      guestCartToken: query.guestCartToken?.trim() || undefined,
    };

    await this.redis.setJson(`auth:oauth:state:${nonce}`, statePayload, OAUTH_STATE_TTL_SECONDS);

    const signedState = await this.jwtService.signAsync<SignedOAuthStateJwt>(
      {
        nonce,
        scope,
        ...(tenantId ? { tenantId } : {}),
      },
      {
        secret: this.config.get('OAUTH_STATE_SECRET', { infer: true }),
        expiresIn: '5m',
      },
    );

    const params = new URLSearchParams({
      client_id: this.config.get('GOOGLE_CLIENT_ID', { infer: true }),
      redirect_uri: this.config.get('GOOGLE_CALLBACK_URL', { infer: true }),
      response_type: 'code',
      scope: 'openid email profile',
      state: signedState,
      prompt: 'select_account',
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  async handleCallback(query: GoogleCallbackQueryDto): Promise<string> {
    const capabilities = this.getCapabilities();
    if (!capabilities.googleEnabled) {
      return `${this.frontendUrl}/login?oauth=unavailable&mode=local-fallback`;
    }

    if (query.error || !query.code || !query.state) {
      return `${this.frontendUrl}/login?oauth=error`;
    }

    let decodedState: SignedOAuthStateJwt;
    try {
      decodedState = await this.jwtService.verifyAsync<SignedOAuthStateJwt>(query.state, {
        secret: this.config.get('OAUTH_STATE_SECRET', { infer: true }),
      });
    } catch {
      return `${this.frontendUrl}/login?oauth=invalid_state`;
    }

    const rawStoredState = await this.redis.getDel(`auth:oauth:state:${decodedState.nonce}`);
    if (!rawStoredState) {
      return `${this.frontendUrl}/login?oauth=invalid_state`;
    }

    const stateData = JSON.parse(rawStoredState) as StoredOAuthStatePayload;
    const returnOrigin = stateData.returnOrigin || this.frontendUrl;

    try {
      const profile = await this.fetchGoogleUserProfile(query.code);
      if (!profile.email || profile.email_verified !== true || !profile.sub) {
        return `${returnOrigin}/login?oauth=unverified_email`;
      }

      const normalizedEmail = profile.email.trim().toLowerCase();
      const googleId = profile.sub;
      const fullName = profile.name?.trim() || normalizedEmail.split('@')[0];

      let exchangePayload: StoredOAuthExchangePayload;

      if (stateData.scope === 'store') {
        if (!stateData.tenantId) {
          return `${returnOrigin}/login?oauth=missing_tenant`;
        }

        const tenant = await this.prisma.tenant.findUnique({
          where: { id: stateData.tenantId },
          select: { id: true, status: true },
        });
        if (!tenant || tenant.status === TenantStatus.SUSPENDED) {
          return `${returnOrigin}/login?oauth=tenant_unavailable`;
        }

        const db = this.prisma.forTenant(stateData.tenantId);
        let customer = await db.storeCustomer.findFirst({
          where: {
            OR: [{ googleId }, { email: normalizedEmail }],
          },
        });

        if (customer) {
          customer = await db.storeCustomer.update({
            where: { id: customer.id },
            data: {
              googleId: customer.googleId ?? googleId,
              emailVerifiedAt: customer.emailVerifiedAt ?? new Date(),
              fullName: customer.fullName || fullName,
            },
          });
        } else {
          customer = await db.storeCustomer.create({
            data: {
              tenantId: stateData.tenantId,
              email: normalizedEmail,
              googleId,
              fullName,
              customerTier: CustomerTier.RETAIL,
              emailVerifiedAt: new Date(),
            },
          });
        }

        exchangePayload = {
          actorType: 'CUSTOMER',
          userId: customer.id,
          tenantId: stateData.tenantId,
          guestCartToken: stateData.guestCartToken,
        };
      } else {
        let user = await this.prisma.platformUser.findFirst({
          where: {
            OR: [{ googleId }, { email: normalizedEmail }],
          },
        });

        if (user) {
          if (!user.isActive) {
            return `${returnOrigin}/login?oauth=account_disabled`;
          }
          user = await this.prisma.platformUser.update({
            where: { id: user.id },
            data: {
              googleId: user.googleId ?? googleId,
              avatarUrl: user.avatarUrl ?? profile.picture ?? null,
              emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
              lastLoginAt: new Date(),
            },
          });
        } else {
          user = await this.prisma.platformUser.create({
            data: {
              email: normalizedEmail,
              googleId,
              fullName,
              avatarUrl: profile.picture ?? null,
              role: PlatformRole.STORE_OWNER,
              emailVerifiedAt: new Date(),
              lastLoginAt: new Date(),
              ownerProfile: {
                create: {
                  country: 'LATAM',
                  onboardingCompleted: false,
                },
              },
            },
          });
        }

        exchangePayload = {
          actorType: 'PLATFORM',
          userId: user.id,
        };
      }

      const rawExchangeCode = randomBytes(32).toString('hex');
      const codeHash = this.hashCode(rawExchangeCode);
      await this.redis.setJson(
        `auth:oauth:code:${codeHash}`,
        exchangePayload,
        OAUTH_EXCHANGE_CODE_TTL_SECONDS,
      );

      return `${returnOrigin}/api/auth/exchange?code=${encodeURIComponent(rawExchangeCode)}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Fallo en callback Google OAuth: ${message}`);
      return `${returnOrigin}/login?oauth=error`;
    }
  }

  async exchangeOneTimeCode(
    dto: GoogleExchangeDto,
    req: RequestWithContext,
    res: Response,
  ): Promise<AuthSessionResponseDto> {
    const codeHash = this.hashCode(dto.code.trim());
    const rawPayload = await this.redis.getDel(`auth:oauth:code:${codeHash}`);

    if (!rawPayload) {
      throw new UnauthorizedException('Código OAuth inválido, ya utilizado o expirado.');
    }

    const payload = JSON.parse(rawPayload) as StoredOAuthExchangePayload;

    if (payload.actorType === 'PLATFORM') {
      const user = await this.prisma.platformUser.findUnique({
        where: { id: payload.userId },
        include: {
          ownedTenants: {
            select: { id: true, slug: true, name: true, status: true },
          },
        },
      });
      if (!user || !user.isActive) {
        throw new UnauthorizedException('Usuario no encontrado o inactivo.');
      }
      const meta: RequestSessionMeta = {
        userAgent: req.headers['user-agent'],
        ipAddress: req.ip,
      };
      const sanitized = await this.authService.issuePlatformSession(user, res, undefined, meta);
      return { user: sanitized };
    }

    if (!payload.tenantId) {
      throw new UnauthorizedException('Código OAuth de tienda sin contexto tenantId.');
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: payload.tenantId },
      select: { id: true, status: true },
    });
    if (!tenant || tenant.status === TenantStatus.SUSPENDED) {
      throw new ForbiddenException({
        message: 'La tienda se encuentra suspendida temporalmente.',
        code: 'TENANT_SUSPENDED',
      });
    }

    const customer = await this.prisma.forTenant(payload.tenantId).storeCustomer.findUnique({
      where: { id: payload.userId },
    });
    if (!customer) {
      throw new UnauthorizedException('Cliente de tienda no encontrado.');
    }

    const guestCartToken =
      dto.guestCartToken?.trim() ||
      payload.guestCartToken?.trim() ||
      req.cookies?.guest_cart_token?.trim();

    const sanitized = await this.authService.issueStoreCustomerSession(
      customer,
      res,
      undefined,
      guestCartToken,
    );
    return { user: sanitized };
  }

  // ===========================================================================
  // TRUSTED HOST & GOOGLE HTTP HELPERS
  // ===========================================================================

  async resolveTrustedReturnOrigin(rawReturnHost?: string): Promise<string> {
    if (!rawReturnHost || !rawReturnHost.trim()) {
      return this.frontendUrl;
    }

    const cleaned = rawReturnHost.trim().toLowerCase();
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*(:\d{1,5})?$/.test(cleaned)) {
      throw new BadRequestException('returnHost no tiene un formato válido.');
    }

    const hostnameOnly = cleaned.split(':')[0];
    if (!hostnameOnly) {
      throw new BadRequestException('returnHost inválido.');
    }

    const isFrontendHost =
      cleaned === this.frontendHost || hostnameOnly === this.frontendHost.split(':')[0];
    const isLocalHost = hostnameOnly === 'localhost' || hostnameOnly === '127.0.0.1';
    const suffix = `.${this.baseHostname}`;
    const sub = hostnameOnly.endsWith(suffix) ? hostnameOnly.slice(0, -suffix.length) : '';
    const isPlatformSubdomain = /^[a-z0-9-]+$/i.test(sub);

    if (isFrontendHost || isLocalHost || isPlatformSubdomain) {
      const protocol =
        isLocalHost || hostnameOnly.endsWith('.localhost') ? 'http:' : this.frontendProtocol;
      return `${protocol}//${cleaned}`;
    }

    const verifiedCustomDomain = await this.prisma.customDomain.findUnique({
      where: { hostname: hostnameOnly },
      select: { isVerified: true },
    });

    if (verifiedCustomDomain?.isVerified) {
      return `https://${cleaned}`;
    }

    throw new BadRequestException('returnHost no está autorizado para redirección OAuth.');
  }

  protected async fetchGoogleUserProfile(code: string): Promise<GoogleUserInfoResponse> {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.config.get('GOOGLE_CLIENT_ID', { infer: true }),
        client_secret: this.config.get('GOOGLE_CLIENT_SECRET', { infer: true }),
        redirect_uri: this.config.get('GOOGLE_CALLBACK_URL', { infer: true }),
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) {
      throw new UnauthorizedException('No se pudo intercambiar el código con Google.');
    }

    const tokenData = (await tokenRes.json()) as GoogleTokenResponse;
    if (!tokenData.access_token) {
      throw new UnauthorizedException('Respuesta inválida de Google OAuth.');
    }

    const userInfoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!userInfoRes.ok) {
      throw new UnauthorizedException('No se pudo obtener el perfil de Google.');
    }

    return (await userInfoRes.json()) as GoogleUserInfoResponse;
  }

  private extractSubdomainSlugFromHost(rawHost?: string): string | undefined {
    if (!rawHost) return undefined;
    const hostname = rawHost.trim().toLowerCase().split(':')[0];
    const suffix = `.${this.baseHostname}`;
    if (hostname.endsWith(suffix)) {
      const sub = hostname.slice(0, -suffix.length);
      if (/^[a-z0-9-]+$/i.test(sub)) {
        return sub;
      }
    }
    return undefined;
  }

  private hashCode(code: string): string {
    return createHash('sha256').update(code).digest('hex');
  }
}
