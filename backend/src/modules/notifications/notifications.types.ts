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
