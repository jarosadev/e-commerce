import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import {
  CustomerTier,
  PlatformRole,
  PlatformUser,
  Prisma,
  StoreCustomer,
  TenantStatus,
} from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash, createHmac, randomInt, randomUUID, timingSafeEqual } from 'crypto';
import type { CookieOptions, Response } from 'express';
import {
  AuthenticatedUserContext,
  RequestWithContext,
  ResolvedTenantContext,
} from '../../common/cls/cls.types';
import { EnvConfig } from '../../config/env.validation';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.module';
import { NotificationsService } from '../notifications/notifications.service';
import {
  EmailOnlyDto,
  LoginDto,
  RefreshTokenDto,
  RegisterDto,
  ResetPasswordDto,
  VerifyOtpDto,
} from './dto/auth-requests.dto';
import {
  AuthMessageResponseDto,
  AuthSessionResponseDto,
  AuthUserDto,
  LogoutResponseDto,
  VerifyOtpResponseDto,
} from './dto/auth-responses.dto';
import { GUEST_CART_MERGER, GuestCartMerger } from './interfaces/guest-cart-merger.interface';

const OTP_TTL_SECONDS = 900; // 15 minutes
const OTP_EXPIRES_IN_MINUTES = 15;
const MAX_OTP_ATTEMPTS = 5;
const MAX_OTP_RESENDS_PER_WINDOW = 15;

export interface RefreshTokenJwtPayload {
  jti: string;
  sub: string;
  familyId: string;
  actorType: 'PLATFORM' | 'CUSTOMER';
  tenantId?: string;
}

export interface RequestSessionMeta {
  userAgent?: string;
  ipAddress?: string;
}

function parseTtlToMs(rawTtl: string, fallbackMs: number): number {
  const trimmed = rawTtl.trim();
  const match = /^(\d+)\s*([smhd])$/i.exec(trimmed);
  if (!match) {
    const numeric = Number(trimmed);
    return Number.isFinite(numeric) && numeric > 0 ? numeric * 1000 : fallbackMs;
  }
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  switch (unit) {
    case 's':
      return amount * 1000;
    case 'm':
      return amount * 60 * 1000;
    case 'h':
      return amount * 60 * 60 * 1000;
    case 'd':
      return amount * 24 * 60 * 60 * 1000;
    default:
      return fallbackMs;
  }
}

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);
  private guestCartMerger?: GuestCartMerger;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService<EnvConfig, true>,
    private readonly notificationsService: NotificationsService,
    private readonly moduleRef: ModuleRef,
  ) {}

  onModuleInit(): void {
    try {
      this.guestCartMerger = this.moduleRef.get<GuestCartMerger>(GUEST_CART_MERGER, {
        strict: false,
      });
    } catch {
      this.guestCartMerger = undefined;
    }
  }

  // ===========================================================================
  // PLATFORM AUTH
  // ===========================================================================

  async registerPlatform(dto: RegisterDto): Promise<AuthUserDto> {
    const email = this.normalizeEmail(dto.email);
    const existing = await this.prisma.platformUser.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('Ya existe una cuenta registrada con este correo electrónico.');
    }

    const passwordHash = await this.hashPassword(dto.password);

    let created: PlatformUser;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        return tx.platformUser.create({
          data: {
            email,
            passwordHash,
            fullName: dto.fullName,
            role: PlatformRole.STORE_OWNER,
            ownerProfile: {
              create: {
                country: 'LATAM',
                onboardingCompleted: false,
              },
            },
          },
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Ya existe una cuenta registrada con este correo electrónico.');
      }
      throw error;
    }

    const otpCode = await this.issueOtp('verify', 'platform', email);
    await this.notificationsService.sendOtpVerification({
      to: email,
      fullName: created.fullName,
      otpCode,
      expiresInMinutes: OTP_EXPIRES_IN_MINUTES,
    });

    return this.sanitizePlatformUser(created);
  }

  async verifyPlatformOtp(dto: VerifyOtpDto): Promise<VerifyOtpResponseDto> {
    const email = this.normalizeEmail(dto.email);
    await this.verifyAndConsumeOtp('verify', 'platform', email, dto.otp);

    const user = await this.prisma.platformUser.findUnique({ where: { email } });
    if (!user) {
      throw new UnauthorizedException('Usuario no encontrado.');
    }

    if (!user.emailVerifiedAt) {
      await this.prisma.platformUser.update({
        where: { id: user.id },
        data: { emailVerifiedAt: new Date() },
      });
    }

    return { verified: true, email };
  }

  async resendPlatformOtp(dto: EmailOnlyDto): Promise<AuthMessageResponseDto> {
    const email = this.normalizeEmail(dto.email);
    await this.enforceResendCap(`auth:otp:resend-rate:platform:${email}`);

    const user = await this.prisma.platformUser.findUnique({ where: { email } });
    if (user && user.isActive) {
      const otpCode = await this.issueOtp('verify', 'platform', email);
      await this.notificationsService.sendOtpVerification({
        to: email,
        fullName: user.fullName,
        otpCode,
        expiresInMinutes: OTP_EXPIRES_IN_MINUTES,
      });
    }

    return {
      success: true,
      message: 'Si el correo está registrado, enviamos un nuevo código de verificación.',
    };
  }

  async loginPlatform(
    dto: LoginDto,
    res: Response,
    meta?: RequestSessionMeta,
  ): Promise<AuthSessionResponseDto> {
    const email = this.normalizeEmail(dto.email);
    const user = await this.prisma.platformUser.findUnique({
      where: { email },
      include: {
        ownedTenants: {
          select: { id: true, slug: true, name: true, status: true },
        },
      },
    });

    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Credenciales inválidas.');
    }

    const passwordValid = await this.verifyPassword(user.passwordHash, dto.password);
    if (!passwordValid) {
      throw new UnauthorizedException('Credenciales inválidas.');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('La cuenta de usuario se encuentra desactivada.');
    }

    if (!user.emailVerifiedAt) {
      throw new ForbiddenException({
        message: 'Debes verificar tu correo electrónico antes de iniciar sesión.',
        code: 'EMAIL_NOT_VERIFIED',
      });
    }

    const updatedUser = await this.prisma.platformUser.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
      include: {
        ownedTenants: {
          select: { id: true, slug: true, name: true, status: true },
        },
      },
    });

    const sanitized = await this.issuePlatformSession(updatedUser, res, undefined, meta);
    return { user: sanitized };
  }

  async forgotPlatformPassword(dto: EmailOnlyDto): Promise<AuthMessageResponseDto> {
    const email = this.normalizeEmail(dto.email);
    await this.enforceResendCap(`auth:otp:reset-rate:platform:${email}`);

    const user = await this.prisma.platformUser.findUnique({ where: { email } });
    if (user && user.isActive) {
      const otpCode = await this.issueOtp('reset', 'platform', email);
      await this.notificationsService.sendPasswordResetOtp({
        to: email,
        fullName: user.fullName,
        otpCode,
        expiresInMinutes: OTP_EXPIRES_IN_MINUTES,
      });
    }

    return {
      success: true,
      message: 'Si el correo existe, enviamos un código para restablecer tu contraseña.',
    };
  }

  async resetPlatformPassword(dto: ResetPasswordDto): Promise<AuthMessageResponseDto> {
    const email = this.normalizeEmail(dto.email);
    await this.verifyAndConsumeOtp('reset', 'platform', email, dto.otp);

    const user = await this.prisma.platformUser.findUnique({ where: { email } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('No se pudo restablecer la contraseña.');
    }

    const newHash = await this.hashPassword(dto.newPassword);
    await this.prisma.$transaction(async (tx) => {
      await tx.platformUser.update({
        where: { id: user.id },
        data: {
          passwordHash: newHash,
          emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
        },
      });
      await tx.platformRefreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });

    return {
      success: true,
      message: 'Contraseña actualizada correctamente.',
    };
  }

  // ===========================================================================
  // STORE CUSTOMER AUTH
  // ===========================================================================

  async registerStoreCustomer(
    tenant: ResolvedTenantContext,
    dto: RegisterDto,
  ): Promise<AuthUserDto> {
    const email = this.normalizeEmail(dto.email);
    const db = this.prisma.forTenant(tenant.id);

    const existing = await db.storeCustomer.findUnique({
      where: {
        tenantId_email: {
          tenantId: tenant.id,
          email,
        },
      },
    });

    if (existing) {
      throw new ConflictException(
        'Ya existe una cuenta registrada con este correo en esta tienda.',
      );
    }

    const passwordHash = await this.hashPassword(dto.password);

    let created: StoreCustomer;
    try {
      created = await db.storeCustomer.create({
        data: {
          tenantId: tenant.id,
          email,
          passwordHash,
          fullName: dto.fullName,
          customerTier: CustomerTier.RETAIL,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(
          'Ya existe una cuenta registrada con este correo en esta tienda.',
        );
      }
      throw error;
    }

    const otpCode = await this.issueOtp('verify', 'customer', email, tenant.id);
    await this.notificationsService.sendOtpVerification({
      to: email,
      fullName: created.fullName,
      otpCode,
      expiresInMinutes: OTP_EXPIRES_IN_MINUTES,
      storeName: tenant.name,
    });

    return this.sanitizeCustomerUser(created);
  }

  async verifyStoreCustomerOtp(
    tenant: ResolvedTenantContext,
    dto: VerifyOtpDto,
  ): Promise<VerifyOtpResponseDto> {
    const email = this.normalizeEmail(dto.email);
    await this.verifyAndConsumeOtp('verify', 'customer', email, dto.otp, tenant.id);

    const db = this.prisma.forTenant(tenant.id);
    const customer = await db.storeCustomer.findUnique({
      where: {
        tenantId_email: {
          tenantId: tenant.id,
          email,
        },
      },
    });

    if (!customer) {
      throw new UnauthorizedException('Cliente no encontrado en esta tienda.');
    }

    if (!customer.emailVerifiedAt) {
      await db.storeCustomer.update({
        where: { id: customer.id },
        data: { emailVerifiedAt: new Date() },
      });
    }

    return { verified: true, email };
  }

  async resendStoreCustomerOtp(
    tenant: ResolvedTenantContext,
    dto: EmailOnlyDto,
  ): Promise<AuthMessageResponseDto> {
    const email = this.normalizeEmail(dto.email);
    await this.enforceResendCap(`auth:otp:resend-rate:customer:${tenant.id}:${email}`);

    const db = this.prisma.forTenant(tenant.id);
    const customer = await db.storeCustomer.findUnique({
      where: {
        tenantId_email: {
          tenantId: tenant.id,
          email,
        },
      },
    });

    if (customer) {
      const otpCode = await this.issueOtp('verify', 'customer', email, tenant.id);
      await this.notificationsService.sendOtpVerification({
        to: email,
        fullName: customer.fullName,
        otpCode,
        expiresInMinutes: OTP_EXPIRES_IN_MINUTES,
        storeName: tenant.name,
      });
    }

    return {
      success: true,
      message: 'Si el correo está registrado en esta tienda, enviamos un nuevo código OTP.',
    };
  }

  async loginStoreCustomer(
    tenant: ResolvedTenantContext,
    dto: LoginDto,
    req: RequestWithContext,
    res: Response,
  ): Promise<AuthSessionResponseDto> {
    const email = this.normalizeEmail(dto.email);
    const db = this.prisma.forTenant(tenant.id);

    const customer = await db.storeCustomer.findUnique({
      where: {
        tenantId_email: {
          tenantId: tenant.id,
          email,
        },
      },
    });

    if (!customer || !customer.passwordHash) {
      throw new UnauthorizedException('Credenciales inválidas.');
    }

    const passwordValid = await this.verifyPassword(customer.passwordHash, dto.password);
    if (!passwordValid) {
      throw new UnauthorizedException('Credenciales inválidas.');
    }

    if (!customer.emailVerifiedAt) {
      throw new ForbiddenException({
        message: 'Debes verificar tu correo electrónico antes de iniciar sesión.',
        code: 'EMAIL_NOT_VERIFIED',
      });
    }

    const guestCartToken =
      dto.guestCartToken?.trim() ||
      req.cookies?.guest_cart_token?.trim() ||
      (typeof req.headers['x-guest-token'] === 'string'
        ? req.headers['x-guest-token'].trim()
        : undefined);
    const sanitized = await this.issueStoreCustomerSession(
      customer,
      res,
      undefined,
      guestCartToken,
    );
    return { user: sanitized };
  }

  async forgotStoreCustomerPassword(
    tenant: ResolvedTenantContext,
    dto: EmailOnlyDto,
  ): Promise<AuthMessageResponseDto> {
    const email = this.normalizeEmail(dto.email);
    await this.enforceResendCap(`auth:otp:reset-rate:customer:${tenant.id}:${email}`);

    const db = this.prisma.forTenant(tenant.id);
    const customer = await db.storeCustomer.findUnique({
      where: {
        tenantId_email: {
          tenantId: tenant.id,
          email,
        },
      },
    });

    if (customer) {
      const otpCode = await this.issueOtp('reset', 'customer', email, tenant.id);
      await this.notificationsService.sendPasswordResetOtp({
        to: email,
        fullName: customer.fullName,
        otpCode,
        expiresInMinutes: OTP_EXPIRES_IN_MINUTES,
        storeName: tenant.name,
      });
    }

    return {
      success: true,
      message: 'Si el correo existe en esta tienda, enviamos un código para restablecer tu clave.',
    };
  }

  async resetStoreCustomerPassword(
    tenant: ResolvedTenantContext,
    dto: ResetPasswordDto,
  ): Promise<AuthMessageResponseDto> {
    const email = this.normalizeEmail(dto.email);
    await this.verifyAndConsumeOtp('reset', 'customer', email, dto.otp, tenant.id);

    const db = this.prisma.forTenant(tenant.id);
    const customer = await db.storeCustomer.findUnique({
      where: {
        tenantId_email: {
          tenantId: tenant.id,
          email,
        },
      },
    });

    if (!customer) {
      throw new UnauthorizedException('No se pudo restablecer la contraseña.');
    }

    const newHash = await this.hashPassword(dto.newPassword);
    await db.$transaction(async (tx) => {
      await tx.storeCustomer.update({
        where: { id: customer.id },
        data: {
          passwordHash: newHash,
          emailVerifiedAt: customer.emailVerifiedAt ?? new Date(),
        },
      });
      await tx.customerRefreshToken.updateMany({
        where: { customerId: customer.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });

    return {
      success: true,
      message: 'Contraseña actualizada correctamente.',
    };
  }

  // ===========================================================================
  // SESSION MANAGEMENT (REFRESH, LOGOUT, ME)
  // ===========================================================================

  async refreshTokens(
    req: RequestWithContext,
    res: Response,
    dto?: RefreshTokenDto,
  ): Promise<AuthSessionResponseDto> {
    const rawRefreshToken = req.cookies?.refresh_token?.trim() || dto?.refreshToken?.trim() || '';

    if (!rawRefreshToken) {
      this.clearAuthCookies(res);
      throw new UnauthorizedException('Refresh token requerido.');
    }

    let payload: RefreshTokenJwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<RefreshTokenJwtPayload>(rawRefreshToken, {
        secret: this.config.get('JWT_REFRESH_SECRET', { infer: true }),
      });
    } catch {
      this.clearAuthCookies(res);
      throw new UnauthorizedException('Refresh token inválido o expirado.');
    }

    const tokenHash = this.hashToken(rawRefreshToken);

    if (payload.actorType === 'PLATFORM') {
      const record = await this.prisma.platformRefreshToken.findUnique({
        where: { tokenHash },
        include: {
          user: {
            include: {
              ownedTenants: {
                select: { id: true, slug: true, name: true, status: true },
              },
            },
          },
        },
      });

      if (!record) {
        this.clearAuthCookies(res);
        throw new UnauthorizedException('Refresh token no reconocido.');
      }

      if (record.revokedAt !== null) {
        await this.prisma.platformRefreshToken.updateMany({
          where: { familyId: record.familyId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        this.clearAuthCookies(res);
        throw new UnauthorizedException(
          'Sesión revocada por reutilización detectada de refresh token.',
        );
      }

      if (record.expiresAt <= new Date() || !record.user.isActive) {
        await this.prisma.platformRefreshToken.updateMany({
          where: { id: record.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        this.clearAuthCookies(res);
        throw new UnauthorizedException('Refresh token expirado o usuario inactivo.');
      }

      const prepared = await this.preparePlatformSessionTokens(record.user, record.familyId);

      const { rotated } = await this.prisma.$transaction(async (tx) => {
        const resUpdate = await tx.platformRefreshToken.updateMany({
          where: { id: record.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        if (resUpdate.count !== 1) {
          return { rotated: false };
        }
        await tx.platformRefreshToken.create({
          data: {
            id: prepared.tokenId,
            userId: record.user.id,
            tokenHash: this.hashToken(prepared.refreshToken),
            familyId: record.familyId,
            userAgent:
              typeof req.headers['user-agent'] === 'string'
                ? req.headers['user-agent'].slice(0, 500)
                : undefined,
            ipAddress: req.ip?.slice(0, 100),
            expiresAt: prepared.expiresAt,
          },
        });
        return { rotated: true };
      });

      if (!rotated) {
        await this.prisma.platformRefreshToken.updateMany({
          where: { familyId: record.familyId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        this.clearAuthCookies(res);
        throw new UnauthorizedException(
          'Sesión revocada por reutilización detectada de refresh token.',
        );
      }

      this.setAuthCookies(res, prepared.accessToken, prepared.refreshToken);
      return { user: this.sanitizePlatformUser(record.user) };
    }

    // CUSTOMER refresh token rotation
    if (!payload.tenantId) {
      this.clearAuthCookies(res);
      throw new UnauthorizedException('Refresh token de cliente inválido.');
    }

    if (req.tenantId && req.tenantId !== payload.tenantId) {
      this.clearAuthCookies(res);
      throw new UnauthorizedException('El refresh token no pertenece a esta tienda.');
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: payload.tenantId },
      select: { id: true, status: true },
    });
    if (!tenant || tenant.status === TenantStatus.SUSPENDED) {
      this.clearAuthCookies(res);
      throw new ForbiddenException({
        message: 'La tienda se encuentra suspendida temporalmente.',
        code: 'TENANT_SUSPENDED',
      });
    }

    const db = this.prisma.forTenant(payload.tenantId);
    const record = await db.customerRefreshToken.findUnique({
      where: { tokenHash },
      include: { customer: true },
    });

    if (!record) {
      this.clearAuthCookies(res);
      throw new UnauthorizedException('Refresh token no reconocido.');
    }

    if (record.revokedAt !== null) {
      await db.customerRefreshToken.updateMany({
        where: { familyId: record.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      this.clearAuthCookies(res);
      throw new UnauthorizedException(
        'Sesión revocada por reutilización detectada de refresh token.',
      );
    }

    if (record.expiresAt <= new Date()) {
      await db.customerRefreshToken.updateMany({
        where: { id: record.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      this.clearAuthCookies(res);
      throw new UnauthorizedException('Refresh token expirado.');
    }

    const prepared = await this.prepareCustomerSessionTokens(record.customer, record.familyId);

    const { rotated } = await db.$transaction(async (tx) => {
      const resUpdate = await tx.customerRefreshToken.updateMany({
        where: { id: record.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (resUpdate.count !== 1) {
        return { rotated: false };
      }
      await tx.customerRefreshToken.create({
        data: {
          id: prepared.tokenId,
          tenantId: record.customer.tenantId,
          customerId: record.customer.id,
          tokenHash: this.hashToken(prepared.refreshToken),
          familyId: record.familyId,
          expiresAt: prepared.expiresAt,
        },
      });
      return { rotated: true };
    });

    if (!rotated) {
      await db.customerRefreshToken.updateMany({
        where: { familyId: record.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      this.clearAuthCookies(res);
      throw new UnauthorizedException(
        'Sesión revocada por reutilización detectada de refresh token.',
      );
    }

    this.setAuthCookies(res, prepared.accessToken, prepared.refreshToken);
    return { user: this.sanitizeCustomerUser(record.customer) };
  }

  async logout(
    req: RequestWithContext,
    res: Response,
    dto?: RefreshTokenDto,
  ): Promise<LogoutResponseDto> {
    const rawRefreshToken = req.cookies?.refresh_token?.trim() || dto?.refreshToken?.trim() || '';

    if (rawRefreshToken) {
      try {
        const payload = await this.jwtService.verifyAsync<RefreshTokenJwtPayload>(rawRefreshToken, {
          secret: this.config.get('JWT_REFRESH_SECRET', { infer: true }),
          ignoreExpiration: true,
        });
        if (payload.actorType === 'PLATFORM' && payload.familyId) {
          await this.prisma.platformRefreshToken.updateMany({
            where: { familyId: payload.familyId, revokedAt: null },
            data: { revokedAt: new Date() },
          });
        } else if (payload.actorType === 'CUSTOMER' && payload.tenantId && payload.familyId) {
          await this.prisma.forTenant(payload.tenantId).customerRefreshToken.updateMany({
            where: { familyId: payload.familyId, revokedAt: null },
            data: { revokedAt: new Date() },
          });
        }
      } catch {
        // Ignore malformed/invalid refresh token on logout; cookies are still cleared.
      }
    }

    this.clearAuthCookies(res);
    return { loggedOut: true };
  }

  async getMe(userContext: AuthenticatedUserContext): Promise<AuthUserDto> {
    if (userContext.actorType === 'PLATFORM') {
      const user = await this.prisma.platformUser.findUnique({
        where: { id: userContext.sub },
        include: {
          ownedTenants: {
            select: { id: true, slug: true, name: true, status: true },
          },
        },
      });
      if (!user || !user.isActive) {
        throw new UnauthorizedException('Sesión de usuario inválida o inactiva.');
      }
      return this.sanitizePlatformUser(user);
    }

    if (!userContext.tenantId) {
      throw new UnauthorizedException('Contexto de tienda faltante en token de cliente.');
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: userContext.tenantId },
      select: { id: true, status: true },
    });

    if (!tenant || tenant.status === TenantStatus.SUSPENDED) {
      throw new ForbiddenException({
        message: 'La tienda se encuentra suspendida temporalmente.',
        code: 'TENANT_SUSPENDED',
      });
    }

    const customer = await this.prisma.forTenant(userContext.tenantId).storeCustomer.findUnique({
      where: { id: userContext.sub },
    });

    if (!customer) {
      throw new UnauthorizedException('Cliente de tienda no encontrado.');
    }

    return this.sanitizeCustomerUser(customer);
  }

  // ===========================================================================
  // SESSION ISSUANCE HELPERS (SHARED WITH GOOGLE OAUTH BROKER)
  // ===========================================================================

  private async preparePlatformSessionTokens(
    user: PlatformUser,
    existingFamilyId?: string,
  ): Promise<{
    familyId: string;
    tokenId: string;
    expiresAt: Date;
    accessToken: string;
    refreshToken: string;
  }> {
    const familyId = existingFamilyId ?? randomUUID();
    const tokenId = randomUUID();
    const refreshTtlDays = this.config.get('JWT_REFRESH_TTL_DAYS', { infer: true });
    const expiresAt = new Date(Date.now() + refreshTtlDays * 24 * 60 * 60 * 1000);

    const accessPayload: AuthenticatedUserContext = {
      sub: user.id,
      email: user.email,
      actorType: 'PLATFORM',
      role: user.role,
      fullName: user.fullName,
    };

    const refreshPayload: RefreshTokenJwtPayload = {
      jti: tokenId,
      sub: user.id,
      familyId,
      actorType: 'PLATFORM',
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(accessPayload),
      this.jwtService.signAsync(refreshPayload, {
        secret: this.config.get('JWT_REFRESH_SECRET', { infer: true }),
        expiresIn: `${refreshTtlDays}d`,
      }),
    ]);

    return { familyId, tokenId, expiresAt, accessToken, refreshToken };
  }

  private async prepareCustomerSessionTokens(
    customer: StoreCustomer,
    existingFamilyId?: string,
  ): Promise<{
    familyId: string;
    tokenId: string;
    expiresAt: Date;
    accessToken: string;
    refreshToken: string;
  }> {
    const familyId = existingFamilyId ?? randomUUID();
    const tokenId = randomUUID();
    const refreshTtlDays = this.config.get('JWT_REFRESH_TTL_DAYS', { infer: true });
    const expiresAt = new Date(Date.now() + refreshTtlDays * 24 * 60 * 60 * 1000);

    const accessPayload: AuthenticatedUserContext = {
      sub: customer.id,
      email: customer.email,
      actorType: 'CUSTOMER',
      role: 'CUSTOMER',
      tenantId: customer.tenantId,
      fullName: customer.fullName,
    };

    const refreshPayload: RefreshTokenJwtPayload = {
      jti: tokenId,
      sub: customer.id,
      familyId,
      actorType: 'CUSTOMER',
      tenantId: customer.tenantId,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(accessPayload),
      this.jwtService.signAsync(refreshPayload, {
        secret: this.config.get('JWT_REFRESH_SECRET', { infer: true }),
        expiresIn: `${refreshTtlDays}d`,
      }),
    ]);

    return { familyId, tokenId, expiresAt, accessToken, refreshToken };
  }

  async issuePlatformSession(
    user: PlatformUser & {
      ownedTenants?: Array<{ id: string; slug: string; name: string; status: string }>;
    },
    res: Response,
    existingFamilyId?: string,
    meta?: RequestSessionMeta,
  ): Promise<AuthUserDto> {
    const { familyId, tokenId, expiresAt, accessToken, refreshToken } =
      await this.preparePlatformSessionTokens(user, existingFamilyId);

    await this.prisma.platformRefreshToken.create({
      data: {
        id: tokenId,
        userId: user.id,
        tokenHash: this.hashToken(refreshToken),
        familyId,
        userAgent: meta?.userAgent?.slice(0, 500),
        ipAddress: meta?.ipAddress?.slice(0, 100),
        expiresAt,
      },
    });

    this.setAuthCookies(res, accessToken, refreshToken);
    return this.sanitizePlatformUser(user);
  }

  async issueStoreCustomerSession(
    customer: StoreCustomer,
    res: Response,
    existingFamilyId?: string,
    guestCartToken?: string,
  ): Promise<AuthUserDto> {
    const { familyId, tokenId, expiresAt, accessToken, refreshToken } =
      await this.prepareCustomerSessionTokens(customer, existingFamilyId);

    await this.prisma.forTenant(customer.tenantId).customerRefreshToken.create({
      data: {
        id: tokenId,
        tenantId: customer.tenantId,
        customerId: customer.id,
        tokenHash: this.hashToken(refreshToken),
        familyId,
        expiresAt,
      },
    });

    if (guestCartToken && this.guestCartMerger) {
      try {
        await this.guestCartMerger.mergeGuestCartOnLogin({
          tenantId: customer.tenantId,
          customerId: customer.id,
          guestToken: guestCartToken,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`No se pudo fusionar carrito de invitado al iniciar sesión: ${message}`);
      }
    }

    this.setAuthCookies(res, accessToken, refreshToken);
    return this.sanitizeCustomerUser(customer);
  }

  sanitizePlatformUser(
    user: PlatformUser & {
      ownedTenants?: Array<{ id: string; slug: string; name: string; status: string }>;
    },
  ): AuthUserDto {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      actorType: 'PLATFORM',
      role: user.role,
      avatarUrl: user.avatarUrl,
      tenantId: null,
      customerTier: null,
      emailVerifiedAt: user.emailVerifiedAt ? user.emailVerifiedAt.toISOString() : null,
      ...(user.ownedTenants ? { ownedTenants: user.ownedTenants } : {}),
    };
  }

  sanitizeCustomerUser(customer: StoreCustomer): AuthUserDto {
    return {
      id: customer.id,
      email: customer.email,
      fullName: customer.fullName,
      actorType: 'CUSTOMER',
      role: 'CUSTOMER',
      avatarUrl: null,
      tenantId: customer.tenantId,
      customerTier: customer.customerTier,
      emailVerifiedAt: customer.emailVerifiedAt ? customer.emailVerifiedAt.toISOString() : null,
    };
  }

  // ===========================================================================
  // INTERNAL CRYPTO, OTP & COOKIE HELPERS
  // ===========================================================================

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private async hashPassword(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id });
  }

  private async verifyPassword(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  private hashToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }

  private buildOtpKeys(
    purpose: 'verify' | 'reset',
    scope: 'platform' | 'customer',
    email: string,
    tenantId?: string,
  ): { otpKey: string; attemptsKey: string } {
    const scopePart = scope === 'platform' ? 'platform' : `customer:${tenantId ?? ''}`;
    return {
      otpKey: `auth:otp:${purpose}:${scopePart}:${email}`,
      attemptsKey: `auth:otp:${purpose}-attempts:${scopePart}:${email}`,
    };
  }

  private hashOtp(
    purpose: 'verify' | 'reset',
    scope: 'platform' | 'customer',
    email: string,
    otp: string,
    tenantId?: string,
  ): string {
    const secret = this.config.get('OAUTH_STATE_SECRET', { infer: true });
    return createHmac('sha256', secret)
      .update(`${purpose}:${scope}:${tenantId ?? ''}:${email}:${otp}`)
      .digest('hex');
  }

  private async issueOtp(
    purpose: 'verify' | 'reset',
    scope: 'platform' | 'customer',
    email: string,
    tenantId?: string,
  ): Promise<string> {
    const otpCode = randomInt(100000, 1000000).toString();
    const { otpKey, attemptsKey } = this.buildOtpKeys(purpose, scope, email, tenantId);
    const hash = this.hashOtp(purpose, scope, email, otpCode, tenantId);
    await this.redis.setJson(otpKey, { hash }, OTP_TTL_SECONDS);
    await this.redis.del(attemptsKey);
    return otpCode;
  }

  private async verifyAndConsumeOtp(
    purpose: 'verify' | 'reset',
    scope: 'platform' | 'customer',
    email: string,
    otp: string,
    tenantId?: string,
  ): Promise<void> {
    const { otpKey, attemptsKey } = this.buildOtpKeys(purpose, scope, email, tenantId);
    const attempts = await this.redis.incrWithTtl(attemptsKey, OTP_TTL_SECONDS);
    if (attempts > MAX_OTP_ATTEMPTS) {
      await this.redis.del(otpKey);
      throw new UnauthorizedException(
        'Has superado el máximo de intentos permitidos. Solicita un nuevo código OTP.',
      );
    }

    const stored = await this.redis.getJson<{ hash?: string }>(otpKey);
    if (!stored?.hash) {
      throw new UnauthorizedException('Código OTP inválido o expirado.');
    }

    const candidateHash = this.hashOtp(purpose, scope, email, otp.trim(), tenantId);
    const storedBuf = Buffer.from(stored.hash, 'hex');
    const candidateBuf = Buffer.from(candidateHash, 'hex');

    if (
      storedBuf.length === 0 ||
      storedBuf.length !== candidateBuf.length ||
      !timingSafeEqual(storedBuf, candidateBuf)
    ) {
      throw new UnauthorizedException('Código OTP inválido.');
    }

    await Promise.all([this.redis.del(otpKey), this.redis.del(attemptsKey)]);
  }

  private async enforceResendCap(rateKey: string): Promise<void> {
    const count = await this.redis.incrWithTtl(rateKey, OTP_TTL_SECONDS);
    if (count > MAX_OTP_RESENDS_PER_WINDOW) {
      throw new HttpException(
        'Has solicitado demasiados códigos en poco tiempo. Intenta más tarde.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private getBaseCookieOptions(): CookieOptions {
    const nodeEnv = this.config.get('NODE_ENV', { infer: true });
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: nodeEnv === 'production',
      path: '/',
    };
  }

  private setAuthCookies(res: Response, accessToken: string, refreshToken: string): void {
    const base = this.getBaseCookieOptions();
    const accessTtl = this.config.get('JWT_ACCESS_TTL', { infer: true });
    const refreshDays = this.config.get('JWT_REFRESH_TTL_DAYS', { infer: true });

    res.cookie('access_token', accessToken, {
      ...base,
      maxAge: parseTtlToMs(accessTtl, 15 * 60 * 1000),
    });
    res.cookie('refresh_token', refreshToken, {
      ...base,
      maxAge: refreshDays * 24 * 60 * 60 * 1000,
    });
  }

  private clearAuthCookies(res: Response): void {
    const base = this.getBaseCookieOptions();
    res.clearCookie('access_token', base);
    res.clearCookie('refresh_token', base);
  }
}
