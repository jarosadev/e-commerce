import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { RequestWithContext, ResolvedTenantContext } from '../cls/cls.types';

export const CurrentTenant = createParamDecorator(
  (property: keyof ResolvedTenantContext | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<RequestWithContext>();
    const tenant = request.tenant;
    if (!tenant) return undefined;
    return property ? tenant[property] : tenant;
  },
);
