export const NOTIFICATIONS_QUEUE = 'notifications';

export const NOTIFICATION_JOBS = {
  OTP_VERIFICATION: 'send-otp-verification',
  PASSWORD_RESET_OTP: 'send-password-reset-otp',
  WELCOME: 'send-welcome',
  SUBSCRIPTION_PAYMENT_APPROVED: 'send-subscription-payment-approved',
} as const;

export type NotificationJobName = (typeof NOTIFICATION_JOBS)[keyof typeof NOTIFICATION_JOBS];
