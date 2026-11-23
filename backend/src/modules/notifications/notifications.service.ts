import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { NOTIFICATIONS_QUEUE, NOTIFICATION_JOBS } from './notifications.constants';
import {
  OtpVerificationJobData,
  PasswordResetOtpJobData,
  SubscriptionExpiringSoonJobData,
  SubscriptionGracePeriodJobData,
  SubscriptionPaymentApprovedJobData,
  SubscriptionPaymentRejectedJobData,
  SubscriptionSuspendedJobData,
  WelcomeJobData,
} from './notifications.types';

@Injectable()
export class NotificationsService implements OnModuleDestroy {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectQueue(NOTIFICATIONS_QUEUE)
    private readonly notificationsQueue: Queue,
  ) {}

  async sendOtpVerification(payload: OtpVerificationJobData): Promise<string | undefined> {
    const job = await this.notificationsQueue.add(NOTIFICATION_JOBS.OTP_VERIFICATION, payload);
    this.logger.debug(`Encolado OTP verificación (${job.id ?? 'no-id'}) para ${payload.to}`);
    return job.id;
  }

  async sendPasswordResetOtp(payload: PasswordResetOtpJobData): Promise<string | undefined> {
    const job = await this.notificationsQueue.add(NOTIFICATION_JOBS.PASSWORD_RESET_OTP, payload);
    this.logger.debug(`Encolado OTP reset (${job.id ?? 'no-id'}) para ${payload.to}`);
    return job.id;
  }

  async sendWelcome(payload: WelcomeJobData): Promise<string | undefined> {
    const job = await this.notificationsQueue.add(NOTIFICATION_JOBS.WELCOME, payload);
    this.logger.debug(`Encolado email bienvenida (${job.id ?? 'no-id'}) para ${payload.to}`);
    return job.id;
  }

  async sendSubscriptionPaymentApproved(
    payload: SubscriptionPaymentApprovedJobData,
  ): Promise<string | undefined> {
    const job = await this.notificationsQueue.add(
      NOTIFICATION_JOBS.SUBSCRIPTION_PAYMENT_APPROVED,
      payload,
    );
    this.logger.debug(`Encolado email pago aprobado (${job.id ?? 'no-id'}) para ${payload.to}`);
    return job.id;
  }

  async sendSubscriptionPaymentRejected(
    payload: SubscriptionPaymentRejectedJobData,
  ): Promise<string | undefined> {
    const job = await this.notificationsQueue.add(
      NOTIFICATION_JOBS.SUBSCRIPTION_PAYMENT_REJECTED,
      payload,
    );
    this.logger.debug(`Encolado email pago rechazado (${job.id ?? 'no-id'}) para ${payload.to}`);
    return job.id;
  }

  async sendSubscriptionExpiringSoon(
    payload: SubscriptionExpiringSoonJobData,
  ): Promise<string | undefined> {
    const job = await this.notificationsQueue.add(
      NOTIFICATION_JOBS.SUBSCRIPTION_EXPIRING_SOON,
      payload,
    );
    this.logger.debug(
      `Encolado aviso de vencimiento próximo (${job.id ?? 'no-id'}) para ${payload.to}`,
    );
    return job.id;
  }

  async sendSubscriptionGracePeriod(
    payload: SubscriptionGracePeriodJobData,
  ): Promise<string | undefined> {
    const job = await this.notificationsQueue.add(
      NOTIFICATION_JOBS.SUBSCRIPTION_GRACE_PERIOD,
      payload,
    );
    this.logger.debug(
      `Encolado aviso de período de gracia (${job.id ?? 'no-id'}) para ${payload.to}`,
    );
    return job.id;
  }

  async sendSubscriptionSuspended(
    payload: SubscriptionSuspendedJobData,
  ): Promise<string | undefined> {
    const job = await this.notificationsQueue.add(
      NOTIFICATION_JOBS.SUBSCRIPTION_SUSPENDED,
      payload,
    );
    this.logger.debug(`Encolado aviso de suspensión (${job.id ?? 'no-id'}) para ${payload.to}`);
    return job.id;
  }

  async onModuleDestroy(): Promise<void> {
    await this.notificationsQueue.close();
  }
}
