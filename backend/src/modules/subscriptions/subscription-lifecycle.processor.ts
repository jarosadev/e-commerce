import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Queue } from 'bullmq';
import { EnvConfig } from '../../config/env.validation';
import {
  SUBSCRIPTION_LIFECYCLE_JOBS,
  SUBSCRIPTION_LIFECYCLE_QUEUE,
} from './subscriptions.constants';
import { SubscriptionsService } from './subscriptions.service';

@Processor(SUBSCRIPTION_LIFECYCLE_QUEUE)
export class SubscriptionLifecycleProcessor
  extends WorkerHost
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(SubscriptionLifecycleProcessor.name);

  constructor(
    @InjectQueue(SUBSCRIPTION_LIFECYCLE_QUEUE)
    private readonly lifecycleQueue: Queue,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly config: ConfigService<EnvConfig, true>,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    const nodeEnv = this.config.get('NODE_ENV', { infer: true });
    if (nodeEnv === 'test') {
      return;
    }

    try {
      await this.lifecycleQueue.add(
        SUBSCRIPTION_LIFECYCLE_JOBS.PROCESS_EXPIRING,
        {},
        {
          jobId: 'daily-subscription-lifecycle-check',
          repeat: { pattern: '0 6 * * *' },
        },
      );
      this.logger.log('Cron diario de ciclo de vida de suscripciones registrado en BullMQ.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`No se pudo programar cron de suscripciones: ${message}`);
    }
  }

  async process(job: Job): Promise<void> {
    if (job.name !== SUBSCRIPTION_LIFECYCLE_JOBS.PROCESS_EXPIRING) {
      throw new Error(`Job de suscripción desconocido: ${job.name}`);
    }

    await this.subscriptionsService.runSubscriptionLifecycleCheck();
  }

  async onModuleDestroy(): Promise<void> {
    await this.lifecycleQueue.close();
    try {
      await this.worker.close();
    } catch {
      // Worker no inicializado cuando se ejecuta export-openapi
    }
  }
}
