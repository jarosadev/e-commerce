import { Global, Module } from '@nestjs/common';
import { TenantResolutionService } from './services/tenant-resolution.service';

@Global()
@Module({
  providers: [TenantResolutionService],
  exports: [TenantResolutionService],
})
export class CommonModule {}
