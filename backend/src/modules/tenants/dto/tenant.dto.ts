import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BillingCycle, SubscriptionStatus, TenantStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { HEX_COLOR_REGEX, TENANT_SLUG_REGEX } from '../tenants.constants';

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const trimUpper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class ResolveTenantQueryDto {
  @ApiPropertyOptional({ example: 'moda-mayorista' })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(63)
  slug?: string;
}

export class CreateTenantDto {
  @ApiProperty({ example: 'Urban Threads Studio' })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: 'mi-tienda-b2b' })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(63)
  @Matches(TENANT_SLUG_REGEX, {
    message:
      'El slug debe contener solo minúsculas, números y guiones medios sin espacios ni caracteres especiales.',
  })
  slug!: string;

  @ApiPropertyOptional({ example: 'Tienda mayorista y minorista de indumentaria.' })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ example: 'USD', default: 'USD' })
  @IsOptional()
  @Transform(trimUpper)
  @IsString()
  @Length(3, 3)
  currency?: string;

  @ApiPropertyOptional({ example: '5491155551234' })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(30)
  whatsappSalesNumber?: string;

  @ApiPropertyOptional({ example: 'ventas@mitienda.com' })
  @IsOptional()
  @Transform(trimString)
  @IsEmail()
  @MaxLength(255)
  contactEmail?: string;

  @ApiPropertyOptional({ example: 100, minimum: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  minWholesaleAmount?: number;

  @ApiPropertyOptional({ example: 6, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  minWholesaleQty?: number;

  @ApiPropertyOptional({ example: 'EMPRENDEDOR' })
  @IsOptional()
  @Transform(trimUpper)
  @IsString()
  @MaxLength(50)
  planCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  planId?: string;

  @ApiPropertyOptional({ enum: BillingCycle, default: BillingCycle.MONTHLY })
  @IsOptional()
  @IsEnum(BillingCycle)
  billingCycle?: BillingCycle;

  @ApiPropertyOptional({ example: '#0F172A' })
  @IsOptional()
  @Transform(trimString)
  @Matches(HEX_COLOR_REGEX, {
    message: 'primaryColor debe ser un color hexadecimal válido (#RGB o #RRGGBB).',
  })
  primaryColor?: string;

  @ApiPropertyOptional({ example: '#2563EB' })
  @IsOptional()
  @Transform(trimString)
  @Matches(HEX_COLOR_REGEX, {
    message: 'accentColor debe ser un color hexadecimal válido (#RGB o #RRGGBB).',
  })
  accentColor?: string;

  @ApiPropertyOptional({ example: 'Bienvenidos a nuestra tienda' })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(160)
  heroTitle?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(160)
  legalName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(50)
  taxId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(80)
  country?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(80)
  city?: string;
}

export class UpdateStoreThemeDto {
  @ApiPropertyOptional({
    type: String,
    example: 'https://cdn.example.com/logo.png',
    nullable: true,
  })
  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  @MaxLength(500)
  logoUrl?: string | null;

  @ApiPropertyOptional({
    type: String,
    example: 'https://cdn.example.com/favicon.ico',
    nullable: true,
  })
  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  @MaxLength(500)
  faviconUrl?: string | null;

  @ApiPropertyOptional({ example: '#0F172A' })
  @IsOptional()
  @Transform(trimString)
  @Matches(HEX_COLOR_REGEX, {
    message: 'primaryColor debe ser un color hexadecimal válido (#RGB o #RRGGBB).',
  })
  primaryColor?: string;

  @ApiPropertyOptional({ example: '#2563EB' })
  @IsOptional()
  @Transform(trimString)
  @Matches(HEX_COLOR_REGEX, {
    message: 'accentColor debe ser un color hexadecimal válido (#RGB o #RRGGBB).',
  })
  accentColor?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  darkModeDefault?: boolean;

  @ApiPropertyOptional({ type: String, example: 'Colección 2026', nullable: true })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(160)
  heroTitle?: string | null;

  @ApiPropertyOptional({
    type: String,
    example: 'Envíos mayoristas a todo el país',
    nullable: true,
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(320)
  heroSubtitle?: string | null;

  @ApiPropertyOptional({
    type: String,
    example: '10% OFF en compras mayores a $150',
    nullable: true,
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(240)
  announcementText?: string | null;

  @ApiPropertyOptional({ type: 'array', items: { type: 'object' }, nullable: true })
  @IsOptional()
  @IsArray()
  heroBanners?: Record<string, unknown>[] | null;
}

export class StoreThemeDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  tenantId!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  logoUrl!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  faviconUrl!: string | null;

  @ApiProperty({ example: '#0F172A' })
  primaryColor!: string;

  @ApiProperty({ example: '#2563EB' })
  accentColor!: string;

  @ApiProperty()
  darkModeDefault!: boolean;

  @ApiPropertyOptional({ type: String, nullable: true })
  heroTitle!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  heroSubtitle!: string | null;

  @ApiPropertyOptional({ nullable: true, type: 'array', items: { type: 'object' } })
  heroBanners!: unknown;

  @ApiPropertyOptional({ type: String, nullable: true })
  announcementText!: string | null;

  @ApiProperty()
  updatedAt!: string;
}

export class TenantPlanSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  code!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  maxProducts!: number;

  @ApiProperty()
  maxStaff!: number;

  @ApiProperty()
  allowCustomDomain!: boolean;

  @ApiProperty()
  allowCsvImport!: boolean;

  @ApiProperty()
  allowAbandonedCart!: boolean;

  @ApiProperty()
  allowWholesale!: boolean;

  @ApiProperty()
  allowCoupons!: boolean;
}

export class TenantSubscriptionSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  planId!: string;

  @ApiProperty({ enum: BillingCycle })
  billingCycle!: BillingCycle;

  @ApiProperty({ enum: SubscriptionStatus })
  status!: SubscriptionStatus;

  @ApiProperty()
  currentPeriodStart!: string;

  @ApiProperty()
  currentPeriodEnd!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  gracePeriodEndsAt!: string | null;

  @ApiPropertyOptional({ type: TenantPlanSummaryDto })
  plan?: TenantPlanSummaryDto;
}

export class TenantDetailDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  slug!: string;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  description!: string | null;

  @ApiProperty({ enum: TenantStatus })
  status!: TenantStatus;

  @ApiProperty()
  currency!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  whatsappSalesNumber!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  contactEmail!: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  minWholesaleAmount!: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  minWholesaleQty!: number | null;

  @ApiProperty()
  stockReservationMins!: number;

  @ApiPropertyOptional({ type: StoreThemeDto, nullable: true })
  theme!: StoreThemeDto | null;

  @ApiPropertyOptional({ type: TenantSubscriptionSummaryDto, nullable: true })
  subscription!: TenantSubscriptionSummaryDto | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}
