import { ForbiddenException, Injectable } from '@nestjs/common';
import { Plan, Subscription, SubscriptionStatus } from '@prisma/client';
import { PlanFeatureFlag, PlanQuotaResource } from '../../common/decorators/require-plan.decorator';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class PlanQuotaService {
  constructor(private readonly prisma: PrismaService) {}

  async assertQuota(tenantId: string, resource: PlanQuotaResource): Promise<void> {
    const subscription = await this.getActiveSubscriptionWithPlan(tenantId);
    const db = this.prisma.forTenant(tenantId);

    if (resource === 'products') {
      const currentCount = await db.product.count({ where: { isActive: true } });
      if (currentCount >= subscription.plan.maxProducts) {
        throw new ForbiddenException({
          message: `Has alcanzado el límite de ${subscription.plan.maxProducts} productos activos de tu plan ${subscription.plan.name}. Actualiza tu plan para continuar.`,
          code: 'PLAN_QUOTA_EXCEEDED',
        });
      }
      return;
    }

    if (resource === 'staff') {
      const currentCount = await db.tenantMember.count();
      if (currentCount >= subscription.plan.maxStaff) {
        throw new ForbiddenException({
          message: `Has alcanzado el límite de ${subscription.plan.maxStaff} miembros de equipo de tu plan ${subscription.plan.name}. Actualiza tu plan para continuar.`,
          code: 'PLAN_QUOTA_EXCEEDED',
        });
      }
    }
  }

  async assertFeature(tenantId: string, feature: PlanFeatureFlag): Promise<void> {
    const subscription = await this.getActiveSubscriptionWithPlan(tenantId);
    if (!subscription.plan[feature]) {
      throw new ForbiddenException({
        message: `Tu plan ${subscription.plan.name} no incluye la función ${feature}. Actualiza tu plan para habilitarla.`,
        code: 'PLAN_FEATURE_NOT_AVAILABLE',
      });
    }
  }

  private async getActiveSubscriptionWithPlan(
    tenantId: string,
  ): Promise<Subscription & { plan: Plan }> {
    const subscription = await this.prisma.forTenant(tenantId).subscription.findUnique({
      where: { tenantId },
      include: { plan: true },
    });

    if (!subscription) {
      throw new ForbiddenException({
        message: 'La tienda no cuenta con una suscripción activa.',
        code: 'SUBSCRIPTION_INACTIVE',
      });
    }

    const isGraceValid =
      subscription.status === SubscriptionStatus.PAST_DUE &&
      subscription.gracePeriodEndsAt !== null &&
      subscription.gracePeriodEndsAt >= new Date();

    const isStatusAllowed =
      subscription.status === SubscriptionStatus.ACTIVE ||
      subscription.status === SubscriptionStatus.TRIALING ||
      isGraceValid;

    if (!isStatusAllowed) {
      throw new ForbiddenException({
        message: 'La suscripción de la tienda no se encuentra activa.',
        code: 'SUBSCRIPTION_INACTIVE',
      });
    }

    return subscription;
  }
}
