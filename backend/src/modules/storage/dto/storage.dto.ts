import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { StorageUploadScope } from '../storage.constants';

export class PresignUploadRequestDto {
  @ApiProperty({ enum: StorageUploadScope, example: StorageUploadScope.CATALOG })
  @IsEnum(StorageUploadScope)
  scope!: StorageUploadScope;

  @ApiProperty({ example: 'image/webp' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  contentType!: string;

  @ApiProperty({ example: 420500, description: 'Tamaño del archivo en bytes' })
  @IsInt()
  @Min(1)
  sizeBytes!: number;

  @ApiPropertyOptional({ example: 'hoodie-negro.webp' })
  @IsOptional()
  @IsString()
  @MaxLength(180)
  originalFilename?: string;
}

export class PresignUploadResponseDto {
  @ApiProperty()
  uploadUrl!: string;

  @ApiProperty()
  objectKey!: string;

  @ApiProperty()
  bucket!: string;

  @ApiProperty()
  isPrivate!: boolean;

  @ApiPropertyOptional({ nullable: true })
  publicUrl!: string | null;

  @ApiProperty()
  contentType!: string;

  @ApiProperty()
  expiresInSeconds!: number;
}

export class PresignDownloadRequestDto {
  @ApiProperty({ example: 'tenants/uuid/receipts/abc.pdf' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  objectKey!: string;
}

export class PresignDownloadResponseDto {
  @ApiProperty()
  downloadUrl!: string;

  @ApiProperty()
  objectKey!: string;

  @ApiProperty()
  expiresInSeconds!: number;
}
