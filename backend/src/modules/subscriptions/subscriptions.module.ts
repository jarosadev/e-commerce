import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { SUBSCRIPTION_LIFECYCLE_QUEUE } from './subscriptions.constants';
import { SubscriptionLifecycleProcessor } from './subscription-lifecycle.processor';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';

@Module({
  imports: [BullModule.registerQueue({ name: SUBSCRIPTION_LIFECYCLE_QUEUE }), NotificationsModule],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService, SubscriptionLifecycleProcessor],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
