import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import { CLS_TENANT_ID } from '../../../common/cls/cls.constants';
import { AppClsStore, RequestWithContext } from '../../../common/cls/cls.types';
import {
  PlanFeatureFlag,
  PlanQuotaResource,
  REQUIRE_PLAN_FEATURE_KEY,
  REQUIRE_PLAN_QUOTA_KEY,
} from '../../../common/decorators/require-plan.decorator';
import { PlanQuotaService } from '../plan-quota.service';

@Injectable()
export class PlanQuotaGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly planQuotaService: PlanQuotaService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredFeature = this.reflector.getAllAndOverride<PlanFeatureFlag | undefined>(
      REQUIRE_PLAN_FEATURE_KEY,
      [context.getHandler(), context.getClass()],
    );
    const requiredQuota = this.reflector.getAllAndOverride<PlanQuotaResource | undefined>(
      REQUIRE_PLAN_QUOTA_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredFeature && !requiredQuota) {
      return true;
    }

    const req = context.switchToHttp().getRequest<RequestWithContext>();
    const tenantId =
      req.tenant?.id ??
      req.tenantId ??
      (this.cls.isActive() ? this.cls.get(CLS_TENANT_ID) : undefined);

    if (!tenantId) {
      throw new NotFoundException('Tienda no encontrada o dominio no configurado.');
    }

    if (requiredFeature) {
      await this.planQuotaService.assertFeature(tenantId, requiredFeature);
    }
    if (requiredQuota) {
      await this.planQuotaService.assertQuota(tenantId, requiredQuota);
    }

    return true;
  }
}
