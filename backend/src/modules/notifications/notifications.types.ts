export interface OtpVerificationJobData {
  to: string;
  fullName: string;
  otpCode: string;
  expiresInMinutes: number;
  storeName?: string;
}

export interface PasswordResetOtpJobData {
  to: string;
  fullName: string;
  otpCode: string;
  expiresInMinutes: number;
  storeName?: string;
}

export interface WelcomeJobData {
  to: string;
  fullName: string;
  storeName?: string;
  loginUrl?: string;
}

export interface SubscriptionPaymentApprovedJobData {
  to: string;
  ownerName: string;
  storeName: string;
  planName: string;
  amount: string | number;
  currency: string;
  externalReference?: string;
}

export interface SubscriptionPaymentRejectedJobData {
  to: string;
  ownerName: string;
  storeName: string;
  planName: string;
  amount: string | number;
  currency: string;
  reason?: string;
  externalReference?: string;
}

export interface SubscriptionExpiringSoonJobData {
  to: string;
  ownerName: string;
  storeName: string;
  planName: string;
  expiresAt: string;
  daysRemaining: number;
  billingUrl?: string;
}

export interface SubscriptionGracePeriodJobData {
  to: string;
  ownerName: string;
  storeName: string;
  planName: string;
  graceEndsAt: string;
  graceDays: number;
  billingUrl?: string;
}

export interface SubscriptionSuspendedJobData {
  to: string;
  ownerName: string;
  storeName: string;
  planName: string;
  billingUrl?: string;
}
