import { Global, Module } from '@nestjs/common';
import { PlanQuotaGuard } from './guards/plan-quota.guard';
import { PlanQuotaService } from './plan-quota.service';
import { PlansController } from './plans.controller';
import { PlansService } from './plans.service';
import { PlatformAdminPlansController } from './platform-admin-plans.controller';

@Global()
@Module({
  controllers: [PlansController, PlatformAdminPlansController],
  providers: [PlansService, PlanQuotaService, PlanQuotaGuard],
  exports: [PlansService, PlanQuotaService, PlanQuotaGuard],
})
export class PlansModule {}
