import { SetMetadata } from '@nestjs/common';

export const REQUIRE_PLAN_QUOTA_KEY = 'requirePlanQuota';
export const REQUIRE_PLAN_FEATURE_KEY = 'requirePlanFeature';

export type PlanQuotaResource = 'products' | 'staff';
export type PlanFeatureFlag =
  'allowCustomDomain' | 'allowCsvImport' | 'allowAbandonedCart' | 'allowWholesale' | 'allowCoupons';

export const RequirePlanQuota = (resource: PlanQuotaResource) =>
  SetMetadata(REQUIRE_PLAN_QUOTA_KEY, resource);

export const RequirePlanFeature = (feature: PlanFeatureFlag) =>
  SetMetadata(REQUIRE_PLAN_FEATURE_KEY, feature);
