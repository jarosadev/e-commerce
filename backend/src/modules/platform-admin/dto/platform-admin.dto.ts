import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PaymentReviewStatus, TenantStatus } from '@prisma/client';

export class ListClientsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: TenantStatus })
  @IsOptional()
  @IsEnum(TenantStatus)
  tenantStatus?: TenantStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  planCode?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class UpdateClientProfileDto {
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName?: string | null;

  @ApiPropertyOptional({ type: Boolean, nullable: true })
  @IsOptional()
  isActive?: boolean | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  legalName?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  taxId?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phoneWhatsapp?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  country?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  fiscalAddress?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  businessCategory?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  acquisitionSource?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  internalAdminNotes?: string | null;

  @ApiPropertyOptional({ type: Boolean, nullable: true })
  @IsOptional()
  onboardingCompleted?: boolean | null;
}

export class CreateSubscriptionPaymentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  subscriptionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tenantId?: string;

  @ApiProperty()
  @IsNumber()
  amount: number;

  @ApiPropertyOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional()
  @IsString()
  provider?: string;

  @ApiPropertyOptional()
  @IsString()
  externalReference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  receiptFileKey?: string;
}

export class ReviewSubscriptionPaymentDto {
  @ApiProperty({ enum: PaymentReviewStatus })
  @IsEnum(PaymentReviewStatus)
  reviewStatus: PaymentReviewStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class UpdateTenantStatusDto {
  @ApiProperty({ enum: TenantStatus })
  @IsEnum(TenantStatus)
  status: TenantStatus;
}

export class AppendClientNoteDto {
  @ApiProperty({
    example: 'Llamada de seguimiento: confirmó upgrade a Plan Pro la próxima semana.',
  })
  @IsString()
  @MinLength(2)
  @MaxLength(1000)
  note: string;
}

export class ListPaymentsQueryDto {
  @ApiPropertyOptional({ enum: PaymentReviewStatus })
  @IsOptional()
  @IsEnum(PaymentReviewStatus)
  reviewStatus?: PaymentReviewStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tenantId?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
