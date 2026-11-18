import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedUserContext, RequestWithContext } from '../cls/cls.types';

export const CurrentUser = createParamDecorator(
  (property: keyof AuthenticatedUserContext | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<RequestWithContext>();
    const user = request.user;
    if (!user) return undefined;
    return property ? user[property] : user;
  },
);
