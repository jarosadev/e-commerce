import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  BillingCycle,
  PaymentReviewStatus,
  SubscriptionPaymentProvider,
  SubscriptionStatus,
  TenantStatus,
} from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ChangePlanDto {
  @ApiPropertyOptional({ example: 'CRECIMIENTO_PRO' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  planCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  planId?: string;

  @ApiPropertyOptional({ enum: BillingCycle, default: BillingCycle.MONTHLY })
  @IsOptional()
  @IsEnum(BillingCycle)
  billingCycle?: BillingCycle;
}

export class CreateCheckoutSessionDto {
  @ApiPropertyOptional({ example: 'CRECIMIENTO_PRO' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  planCode?: string;

  @ApiPropertyOptional({ enum: BillingCycle, default: BillingCycle.MONTHLY })
  @IsOptional()
  @IsEnum(BillingCycle)
  billingCycle?: BillingCycle;

  @ApiPropertyOptional({ example: 'http://localhost:3000/dashboard?billing=success' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  successUrl?: string;

  @ApiPropertyOptional({ example: 'http://localhost:3000/dashboard?billing=cancelled' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  cancelUrl?: string;
}

export class SubmitManualSubscriptionPaymentDto {
  @ApiProperty({ example: 49.0 })
  @IsNumber()
  @IsPositive()
  amount: number;

  @ApiPropertyOptional({ example: 'USD', default: 'USD' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @ApiProperty({ example: 'TRF-2026-88412' })
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  externalReference: string;

  @ApiPropertyOptional({ example: 'receipts/2026/trf-88412.pdf' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  receiptFileKey?: string;

  @ApiPropertyOptional({ enum: BillingCycle })
  @IsOptional()
  @IsEnum(BillingCycle)
  billingCycle?: BillingCycle;

  @ApiPropertyOptional({ example: 'CRECIMIENTO_PRO' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  targetPlanCode?: string;
}

export class CancelSubscriptionDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  cancelAtPeriodEnd: boolean;
}

export class StripeWebhookPayloadDto {
  @ApiProperty({ example: 'evt_test_123456' })
  @IsString()
  id: string;

  @ApiProperty({
    example: 'invoice.payment_succeeded',
    description:
      'Supported types: invoice.payment_succeeded, checkout.session.completed, invoice.payment_failed, customer.subscription.deleted',
  })
  @IsString()
  type: string;

  @ApiProperty({
    type: Object,
    example: {
      object: {
        amount_paid: 4900,
        currency: 'usd',
        subscription: 'sub_stripe_123',
        metadata: { tenantId: 'uuid', billingCycle: 'MONTHLY' },
      },
    },
  })
  @IsObject()
  data: {
    object: Record<string, unknown>;
  };
}

export class MercadoPagoWebhookPayloadDto {
  @ApiProperty({ example: 'mp_evt_987654' })
  @IsString()
  id: string;

  @ApiProperty({
    example: 'payment.approved',
    description:
      'Supported actions/types: payment.approved, subscription_authorized_payment, payment.rejected, subscription_cancelled',
  })
  @IsString()
  action: string;

  @ApiProperty({
    type: Object,
    example: {
      tenantId: 'uuid',
      subscriptionId: 'uuid',
      amount: 49,
      currency: 'USD',
      externalSubscriptionId: 'mp_preapproval_123',
      billingCycle: 'MONTHLY',
    },
  })
  @IsObject()
  data: Record<string, unknown>;
}

export class SubscriptionPaymentItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: SubscriptionPaymentProvider })
  provider: SubscriptionPaymentProvider;

  @ApiProperty()
  amount: number;

  @ApiProperty()
  currency: string;

  @ApiPropertyOptional({ nullable: true })
  externalReference: string | null;

  @ApiPropertyOptional({ nullable: true })
  receiptFileKey: string | null;

  @ApiProperty({ enum: PaymentReviewStatus })
  reviewStatus: PaymentReviewStatus;

  @ApiPropertyOptional({ nullable: true })
  paidAt: string | null;

  @ApiProperty()
  createdAt: string;
}

export class SubscriptionUsageDto {
  @ApiProperty()
  productsUsed: number;

  @ApiProperty()
  maxProducts: number;

  @ApiProperty()
  productsUsagePercent: number;

  @ApiProperty()
  staffUsed: number;

  @ApiProperty()
  maxStaff: number;

  @ApiProperty()
  staffUsagePercent: number;
}

export class SubscriptionSummaryDto {
  @ApiProperty()
  tenantId: string;

  @ApiProperty()
  tenantSlug: string;

  @ApiProperty()
  tenantName: string;

  @ApiProperty({ enum: TenantStatus })
  tenantStatus: TenantStatus;

  @ApiProperty()
  subscriptionId: string;

  @ApiProperty({ enum: SubscriptionStatus })
  status: SubscriptionStatus;

  @ApiProperty({ enum: BillingCycle })
  billingCycle: BillingCycle;

  @ApiProperty()
  currentPeriodStart: string;

  @ApiProperty()
  currentPeriodEnd: string;

  @ApiPropertyOptional({ nullable: true })
  gracePeriodEndsAt: string | null;

  @ApiProperty()
  cancelAtPeriodEnd: boolean;

  @ApiProperty()
  daysUntilPeriodEnd: number;

  @ApiProperty()
  isInGracePeriod: boolean;

  @ApiProperty()
  graceDaysRemaining: number;

  @ApiProperty({ type: Object })
  plan: {
    id: string;
    code: string;
    name: string;
    description: string | null;
    priceMonthly: number;
    priceYearly: number;
    currency: string;
    maxProducts: number;
    maxStaff: number;
    allowCustomDomain: boolean;
    allowCsvImport: boolean;
    allowAbandonedCart: boolean;
    allowWholesale: boolean;
    allowCoupons: boolean;
  };

  @ApiProperty({ type: SubscriptionUsageDto })
  usage: SubscriptionUsageDto;

  @ApiProperty({ type: [SubscriptionPaymentItemDto] })
  payments: SubscriptionPaymentItemDto[];

  @ApiProperty({ type: [Object] })
  availablePlans: Array<{
    id: string;
    code: string;
    name: string;
    description: string | null;
    priceMonthly: number;
    priceYearly: number;
    currency: string;
    maxProducts: number;
    maxStaff: number;
    allowCustomDomain: boolean;
    allowCsvImport: boolean;
    allowAbandonedCart: boolean;
    allowWholesale: boolean;
    allowCoupons: boolean;
  }>;
}

export class CheckoutSessionResponseDto {
  @ApiProperty({ enum: ['STRIPE', 'MERCADOPAGO'] })
  provider: 'STRIPE' | 'MERCADOPAGO';

  @ApiProperty({ enum: ['live', 'sandbox'] })
  mode: 'live' | 'sandbox';

  @ApiProperty()
  sessionId: string;

  @ApiProperty()
  checkoutUrl: string;

  @ApiProperty()
  amount: number;

  @ApiProperty()
  currency: string;

  @ApiProperty()
  planCode: string;

  @ApiProperty({ enum: BillingCycle })
  billingCycle: BillingCycle;
}

export class WebhookAckDto {
  @ApiProperty()
  received: boolean;

  @ApiProperty()
  duplicate: boolean;

  @ApiProperty()
  provider: string;

  @ApiProperty()
  eventId: string;

  @ApiProperty()
  actionTaken: string;
}

export class LifecycleRunResultDto {
  @ApiProperty()
  remindedCount: number;

  @ApiProperty()
  movedToGraceCount: number;

  @ApiProperty()
  suspendedCount: number;

  @ApiProperty()
  canceledAtPeriodEndCount: number;

  @ApiProperty()
  executedAt: string;
}
