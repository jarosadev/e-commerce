import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ClsService } from 'nestjs-cls';
import { EnvConfig } from '../../config/env.validation';
import { CLS_TENANT_ID, CLS_USER } from '../cls/cls.constants';
import { AppClsStore, AuthenticatedUserContext, RequestWithContext } from '../cls/cls.types';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { IS_OPTIONAL_AUTH_KEY } from '../decorators/optional-auth.decorator';
import { TenantResolutionService } from '../services/tenant-resolution.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService<EnvConfig, true>,
    private readonly cls: ClsService<AppClsStore>,
    @Optional() private readonly tenantResolutionService?: TenantResolutionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const isOptionalAuth = this.reflector.getAllAndOverride<boolean>(IS_OPTIONAL_AUTH_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const req = context.switchToHttp().getRequest<RequestWithContext>();
    const token = this.extractToken(req);

    if (!token) {
      if (isOptionalAuth) {
        return true;
      }
      throw new UnauthorizedException('Token de acceso requerido.');
    }

    let payload: AuthenticatedUserContext;
    try {
      payload = await this.jwtService.verifyAsync<AuthenticatedUserContext>(token, {
        secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
      });
    } catch {
      if (isOptionalAuth) {
        return true;
      }
      throw new UnauthorizedException('Token de acceso inválido o expirado.');
    }

    if (payload.actorType === 'CUSTOMER') {
      const resolvedTenant = await this.tenantResolutionService?.resolveFromRequest(req);
      const resolvedTenantId =
        resolvedTenant?.id ??
        req.tenantId ??
        (this.cls.isActive() ? this.cls.get(CLS_TENANT_ID) : undefined);

      if (resolvedTenantId && payload.tenantId !== resolvedTenantId) {
        if (isOptionalAuth) {
          return true;
        }
        throw new UnauthorizedException('El token de cliente no pertenece a esta tienda.');
      }
    }

    req.user = payload;
    if (this.cls.isActive()) {
      this.cls.set(CLS_USER, payload);
    }

    return true;
  }

  private extractToken(req: RequestWithContext): string | null {
    const authHeader = req.headers.authorization;
    if (typeof authHeader === 'string') {
      const [scheme, token] = authHeader.split(' ');
      if (scheme?.toLowerCase() === 'bearer' && token) {
        return token.trim();
      }
    }

    const cookieToken = req.cookies?.access_token;
    if (typeof cookieToken === 'string' && cookieToken.trim().length > 0) {
      return cookieToken.trim();
    }

    return null;
  }
}
