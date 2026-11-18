import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

const trimUpper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreatePlanDto {
  @ApiProperty({ example: 'CRECIMIENTO_PRO' })
  @Transform(trimUpper)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  @Matches(/^[A-Z0-9_-]+$/, {
    message: 'El código del plan solo puede contener letras mayúsculas, números, _ o -.',
  })
  code!: string;

  @ApiProperty({ example: 'Plan Crecimiento Pro' })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ example: 'Dominio propio, importador CSV y mayorista B2B.' })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ example: 49, minimum: 0 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  priceMonthly!: number;

  @ApiProperty({ example: 490, minimum: 0 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  priceYearly!: number;

  @ApiPropertyOptional({ example: 'USD', default: 'USD' })
  @IsOptional()
  @Transform(trimUpper)
  @IsString()
  @Length(3, 3)
  currency?: string;

  @ApiProperty({ example: 1500, minimum: 1 })
  @IsInt()
  @Min(1)
  maxProducts!: number;

  @ApiProperty({ example: 3, minimum: 1 })
  @IsInt()
  @Min(1)
  maxStaff!: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  allowCustomDomain?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  allowCsvImport?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  allowAbandonedCart?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  allowWholesale?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  allowCoupons?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ default: 0, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdatePlanDto extends PartialType(CreatePlanDto) {}

export class PlanResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  code!: string;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  description!: string | null;

  @ApiProperty({ example: 49 })
  priceMonthly!: number;

  @ApiProperty({ example: 490 })
  priceYearly!: number;

  @ApiProperty({ example: 'USD' })
  currency!: string;

  @ApiProperty({ example: 1500 })
  maxProducts!: number;

  @ApiProperty({ example: 3 })
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

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty()
  sortOrder!: number;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}
