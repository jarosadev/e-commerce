import { Module } from '@nestjs/common';
import { StoreOpsController } from './store-ops.controller';
import { StoreOpsService } from './store-ops.service';

@Module({
  controllers: [StoreOpsController],
  providers: [StoreOpsService],
  exports: [StoreOpsService],
})
export class StoreOpsModule {}
