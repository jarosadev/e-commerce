import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PlatformRole, TenantStatus } from '@prisma/client';
import { RequestWithContext } from '../cls/cls.types';
import { REQUIRE_TENANT_KEY, SKIP_TENANT_STATUS_KEY } from '../decorators/require-tenant.decorator';
import { TenantResolutionService } from '../services/tenant-resolution.service';

@Injectable()
export class TenantStatusGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tenantResolutionService: TenantResolutionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') {
      return true;
    }

    const skipTenantStatus = this.reflector.getAllAndOverride<boolean>(SKIP_TENANT_STATUS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skipTenantStatus) {
      return true;
    }

    const req = context.switchToHttp().getRequest<RequestWithContext>();
    const tenant = await this.tenantResolutionService.resolveFromRequest(req);

    const requireTenant = this.reflector.getAllAndOverride<boolean>(REQUIRE_TENANT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (requireTenant && !tenant) {
      throw new NotFoundException('Tienda no encontrada o dominio no configurado.');
    }

    if (tenant && tenant.status === TenantStatus.SUSPENDED) {
      if (req.user?.role !== PlatformRole.SUPER_ADMIN) {
        throw new ForbiddenException({
          message: 'La tienda se encuentra suspendida temporalmente.',
          code: 'TENANT_SUSPENDED',
        });
      }
    }

    return true;
  }
}
