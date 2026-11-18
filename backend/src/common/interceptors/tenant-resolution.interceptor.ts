import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { RequestWithContext } from '../cls/cls.types';
import { TenantResolutionService } from '../services/tenant-resolution.service';

@Injectable()
export class TenantResolutionInterceptor implements NestInterceptor {
  constructor(private readonly tenantResolutionService: TenantResolutionService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    if (context.getType() === 'http') {
      const req = context.switchToHttp().getRequest<RequestWithContext>();
      await this.tenantResolutionService.resolveFromRequest(req);
    }
    return next.handle();
  }
}
