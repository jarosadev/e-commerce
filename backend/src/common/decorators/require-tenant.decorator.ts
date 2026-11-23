import { SetMetadata } from '@nestjs/common';

export const REQUIRE_TENANT_KEY = 'requireTenant';
export const SKIP_TENANT_STATUS_KEY = 'skipTenantStatus';

export const RequireTenant = () => SetMetadata(REQUIRE_TENANT_KEY, true);
export const SkipTenantStatus = () => SetMetadata(SKIP_TENANT_STATUS_KEY, true);
