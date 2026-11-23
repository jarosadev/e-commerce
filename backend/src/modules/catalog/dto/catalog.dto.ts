import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// ============================================================================
// CATEGORIES
// ============================================================================

export class CreateCategoryDto {
  @ApiProperty({ example: 'Hoodies & Buzos' })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ example: 'hoodies-buzos' })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(120)
  slug?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  parentId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(500)
  imageUrl?: string | null;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateCategoryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(120)
  slug?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  parentId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(500)
  imageUrl?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// ============================================================================
// PRODUCT IMAGES, VARIANTS & WHOLESALE TIERS
// ============================================================================

export class ProductImageInputDto {
  @ApiProperty({ example: 'http://localhost:9000/catalog-public/tenants/.../img.webp' })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  url!: string;

  @ApiPropertyOptional({ example: 'Vista frontal Hoodie' })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(200)
  altText?: string | null;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class CreateVariantDto {
  @ApiProperty({ example: 'UT-HD-BLK-XL' })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  sku!: string;

  @ApiProperty({ example: 'Talla XL · Negro Ónix' })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  title!: string;

  @ApiProperty({ type: Object, example: { talla: 'XL', color: 'Negro Ónix' } })
  @IsObject()
  attributes!: Record<string, string>;

  @ApiProperty({ example: 42.0 })
  @IsNumber()
  @IsPositive()
  retailPrice!: number;

  @ApiPropertyOptional({ example: 52.0, nullable: true })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  compareAtPrice?: number | null;

  @ApiPropertyOptional({ example: 40, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  stockOnHand?: number;

  @ApiPropertyOptional({ example: 5, default: 5 })
  @IsOptional()
  @IsInt()
  @Min(0)
  lowStockThreshold?: number;

  @ApiPropertyOptional({ example: 650, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  weightGrams?: number | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateVariantDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(80)
  sku?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(160)
  title?: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  attributes?: Record<string, string>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @IsPositive()
  retailPrice?: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  compareAtPrice?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  lowStockThreshold?: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  weightGrams?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class VariantMatrixAxisDto {
  @ApiProperty({ example: 'talla' })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  name!: string;

  @ApiProperty({ type: [String], example: ['S', 'M', 'L'] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsString({ each: true })
  values!: string[];
}

export class GenerateVariantMatrixDto {
  @ApiProperty({ type: [VariantMatrixAxisDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => VariantMatrixAxisDto)
  axes!: VariantMatrixAxisDto[];

  @ApiProperty({ example: 'REM-BOX' })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  skuPrefix!: string;

  @ApiProperty({ example: 25.0 })
  @IsNumber()
  @IsPositive()
  retailPrice!: number;

  @ApiPropertyOptional({ example: 32.0, nullable: true })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  compareAtPrice?: number | null;

  @ApiPropertyOptional({ example: 20, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  stockOnHand?: number;

  @ApiPropertyOptional({ example: 5, default: 5 })
  @IsOptional()
  @IsInt()
  @Min(0)
  lowStockThreshold?: number;

  @ApiPropertyOptional({ example: 350, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  weightGrams?: number | null;
}

export enum StockAdjustmentMode {
  SET = 'SET',
  DELTA = 'DELTA',
}

export class AdjustStockDto {
  @ApiProperty({ enum: StockAdjustmentMode, example: StockAdjustmentMode.DELTA })
  @IsEnum(StockAdjustmentMode)
  mode!: StockAdjustmentMode;

  @ApiProperty({ example: 10, description: 'Cantidad final (SET) o variación +/- (DELTA)' })
  @IsInt()
  quantity!: number;
}

export class WholesaleTierInputDto {
  @ApiProperty({ example: 6 })
  @IsInt()
  @Min(2)
  minQuantity!: number;

  @ApiPropertyOptional({ example: 11, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(2)
  maxQuantity?: number | null;

  @ApiProperty({ example: 32.5 })
  @IsNumber()
  @IsPositive()
  unitPrice!: number;

  @ApiPropertyOptional({ example: 'Media Docena Mayorista', nullable: true })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(80)
  label?: string | null;
}

export class ReplaceWholesaleTiersDto {
  @ApiProperty({ type: [WholesaleTierInputDto] })
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => WholesaleTierInputDto)
  tiers!: WholesaleTierInputDto[];
}

// ============================================================================
// PRODUCTS
// ============================================================================

export class ListCatalogProductsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimString)
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  isWholesaleOnly?: boolean;

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

export class CreateProductDto {
  @ApiProperty({ example: 'Remera Oversize Algodón 240gsm' })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(180)
  name!: string;

  @ApiPropertyOptional({ example: 'remera-oversize-algodon-240gsm' })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(180)
  slug?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  categoryId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(300)
  shortDescription?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(5000)
  description?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(100)
  brand?: string | null;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isWholesaleOnly?: boolean;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  minOrderQty?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ type: [ProductImageInputDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => ProductImageInputDto)
  images?: ProductImageInputDto[];

  @ApiPropertyOptional({ type: [CreateVariantDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateVariantDto)
  variants?: CreateVariantDto[];

  @ApiPropertyOptional({ type: [WholesaleTierInputDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => WholesaleTierInputDto)
  wholesaleTiers?: WholesaleTierInputDto[];
}

export class UpdateProductDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MinLength(2)
  @MaxLength(180)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(180)
  slug?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  categoryId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(300)
  shortDescription?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(5000)
  description?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(100)
  brand?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isWholesaleOnly?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  minOrderQty?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ type: [ProductImageInputDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => ProductImageInputDto)
  images?: ProductImageInputDto[];
}
