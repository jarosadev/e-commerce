export const SUBSCRIPTION_LIFECYCLE_QUEUE = 'subscription-lifecycle';

export const SUBSCRIPTION_LIFECYCLE_JOBS = {
  PROCESS_EXPIRING: 'process-expiring-subscriptions',
} as const;

export const WEBHOOK_IDEMPOTENCY_TTL_SECONDS = 7 * 24 * 60 * 60;
export const REMINDER_DEDUPE_TTL_SECONDS = 7 * 24 * 60 * 60;
