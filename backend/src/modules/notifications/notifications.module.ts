import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { NOTIFICATIONS_QUEUE } from './notifications.constants';
import { NotificationsProcessor } from './notifications.processor';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: NOTIFICATIONS_QUEUE,
      forceDisconnectOnShutdown: true,
    }),
  ],
  providers: [NotificationsService, NotificationsProcessor],
  exports: [NotificationsService],
})
export class NotificationsModule {}
