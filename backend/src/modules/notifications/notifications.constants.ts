export const NOTIFICATIONS_QUEUE = 'notifications';

export const NOTIFICATION_JOBS = {
  OTP_VERIFICATION: 'send-otp-verification',
  PASSWORD_RESET_OTP: 'send-password-reset-otp',
  WELCOME: 'send-welcome',
  SUBSCRIPTION_PAYMENT_APPROVED: 'send-subscription-payment-approved',
  SUBSCRIPTION_PAYMENT_REJECTED: 'send-subscription-payment-rejected',
  SUBSCRIPTION_EXPIRING_SOON: 'send-subscription-expiring-soon',
  SUBSCRIPTION_GRACE_PERIOD: 'send-subscription-grace-period',
  SUBSCRIPTION_SUSPENDED: 'send-subscription-suspended',
} as const;

export type NotificationJobName = (typeof NOTIFICATION_JOBS)[keyof typeof NOTIFICATION_JOBS];
