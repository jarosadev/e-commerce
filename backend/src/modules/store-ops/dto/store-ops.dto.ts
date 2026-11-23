import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CustomerTier, StorePaymentType } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// ============================================================================
// MANUAL PAYMENT METHODS
// ============================================================================

export class CreatePaymentMethodDto {
  @ApiProperty({ enum: StorePaymentType, example: StorePaymentType.BANK_TRANSFER })
  @IsEnum(StorePaymentType)
  type!: StorePaymentType;

  @ApiProperty({ example: 'Transferencia Banco Nación' })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(120)
  title!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(1000)
  instructions?: string | null;

  @ApiPropertyOptional({
    type: Object,
    nullable: true,
    example: { banco: 'Banco Nación', alias: 'MI.TIENDA', titular: 'Mi Tienda SRL' },
  })
  @IsOptional()
  @IsObject()
  accountDetailsJson?: Record<string, string> | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(1000)
  qrImageUrl?: string | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  requiresReceipt?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdatePaymentMethodDto {
  @ApiPropertyOptional({ enum: StorePaymentType })
  @IsOptional()
  @IsEnum(StorePaymentType)
  type?: StorePaymentType;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  title?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(1000)
  instructions?: string | null;

  @ApiPropertyOptional({ type: Object, nullable: true })
  @IsOptional()
  @IsObject()
  accountDetailsJson?: Record<string, string> | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(1000)
  qrImageUrl?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requiresReceipt?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// ============================================================================
// SHIPPING ZONES & LOCAL PICKUP
// ============================================================================

export class CreateShippingZoneDto {
  @ApiProperty({ example: 'Envío Moto Express AMBA' })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ type: [String], example: ['CABA', 'Vicente López', 'San Isidro'] })
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  cities!: string[];

  @ApiProperty({ example: 6.5 })
  @IsNumber()
  @Min(0)
  flatRate!: number;

  @ApiPropertyOptional({ example: 100, nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  freeShippingThreshold?: number | null;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isLocalPickup?: boolean;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(300)
  pickupAddress?: string | null;

  @ApiPropertyOptional({ example: '24 a 48 hs hábiles', nullable: true })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(80)
  estimatedDays?: string | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateShippingZoneDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  cities?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  flatRate?: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  freeShippingThreshold?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isLocalPickup?: boolean;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(300)
  pickupAddress?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(80)
  estimatedDays?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// ============================================================================
// STORE CUSTOMERS CRM & B2B TIER TAGGING
// ============================================================================

export class ListStoreCustomersQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimString)
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: CustomerTier })
  @IsOptional()
  @IsEnum(CustomerTier)
  customerTier?: CustomerTier;

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

export class UpdateStoreCustomerTierDto {
  @ApiProperty({ enum: CustomerTier, example: CustomerTier.WHOLESALE_B2B })
  @IsEnum(CustomerTier)
  customerTier!: CustomerTier;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(40)
  phone?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(60)
  taxId?: string | null;
}
