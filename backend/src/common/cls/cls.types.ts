import { PlatformRole, SubscriptionStatus, TenantStatus } from '@prisma/client';
import { Request } from 'express';
import { ClsStore } from 'nestjs-cls';
import { CLS_REQUEST_ID, CLS_TENANT, CLS_TENANT_ID, CLS_USER } from './cls.constants';

export type ActorType = 'PLATFORM' | 'CUSTOMER';
export type AllowedRole = PlatformRole | 'CUSTOMER';

export interface ResolvedTenantContext {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  currency: string;
  ownerId: string;
  subscriptionStatus?: SubscriptionStatus | null;
  gracePeriodEndsAt?: string | null;
}

export interface AuthenticatedUserContext {
  sub: string;
  email: string;
  actorType: ActorType;
  role: AllowedRole;
  tenantId?: string;
  fullName?: string;
}

export interface AppClsStore extends ClsStore {
  [CLS_TENANT_ID]?: string;
  [CLS_TENANT]?: ResolvedTenantContext;
  [CLS_USER]?: AuthenticatedUserContext;
  [CLS_REQUEST_ID]?: string;
}

export interface RequestWithContext extends Request {
  tenantId?: string;
  tenant?: ResolvedTenantContext;
  user?: AuthenticatedUserContext;
  cookies: Record<string, string | undefined>;
}
