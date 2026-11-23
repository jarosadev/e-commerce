import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { EnvConfig } from '../../config/env.validation';
import {
  PresignDownloadResponseDto,
  PresignUploadRequestDto,
  PresignUploadResponseDto,
} from './dto/storage.dto';
import {
  PRESIGN_PRIVATE_READ_TTL_SECONDS,
  PRESIGN_UPLOAD_TTL_SECONDS,
  STORAGE_SCOPE_RULES,
} from './storage.constants';

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3Client: S3Client;
  private readonly publicBucket: string;
  private readonly privateBucket: string;
  private readonly publicBaseUrl: string;

  constructor(private readonly config: ConfigService<EnvConfig, true>) {
    const endpoint = this.config.get('S3_ENDPOINT', { infer: true });
    const region = this.config.get('S3_REGION', { infer: true });
    const accessKeyId = this.config.get('S3_ACCESS_KEY', { infer: true });
    const secretAccessKey = this.config.get('S3_SECRET_KEY', { infer: true });

    this.publicBucket = this.config.get('S3_PUBLIC_BUCKET', { infer: true });
    this.privateBucket = this.config.get('S3_PRIVATE_BUCKET', { infer: true });
    this.publicBaseUrl = this.config.get('S3_PUBLIC_BASE_URL', { infer: true }).replace(/\/+$/, '');

    this.s3Client = new S3Client({
      region,
      endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
  }

  async onModuleInit(): Promise<void> {
    const nodeEnv = this.config.get('NODE_ENV', { infer: true });
    if (nodeEnv === 'test') {
      return;
    }

    await Promise.all([
      this.ensureBucketExists(this.publicBucket),
      this.ensureBucketExists(this.privateBucket),
    ]);
  }

  async createPresignedUploadUrl(
    tenantId: string,
    dto: PresignUploadRequestDto,
  ): Promise<PresignUploadResponseDto> {
    const rule = STORAGE_SCOPE_RULES[dto.scope];
    if (!rule) {
      throw new BadRequestException('Alcance de almacenamiento no soportado.');
    }

    const normalizedMime = dto.contentType.trim().toLowerCase();
    const ext = rule.allowedMimeTypes.get(normalizedMime);
    if (!ext) {
      const allowed = Array.from(rule.allowedMimeTypes.keys()).join(', ');
      throw new BadRequestException({
        code: 'INVALID_FILE_MIME',
        message: `Tipo de archivo no permitido (${normalizedMime}). Permitidos para ${dto.scope}: ${allowed}.`,
      });
    }

    if (dto.sizeBytes > rule.maxBytes) {
      const maxMb = (rule.maxBytes / (1024 * 1024)).toFixed(1);
      throw new BadRequestException({
        code: 'FILE_TOO_LARGE',
        message: `El archivo excede el tamaño máximo permitido de ${maxMb} MB para ${dto.scope}.`,
      });
    }

    const bucket = rule.isPrivate ? this.privateBucket : this.publicBucket;
    const objectKey = `tenants/${tenantId}/${dto.scope}/${randomUUID()}.${ext}`;

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      ContentType: normalizedMime,
      ContentLength: dto.sizeBytes,
    });

    const uploadUrl = await getSignedUrl(this.s3Client, command, {
      expiresIn: PRESIGN_UPLOAD_TTL_SECONDS,
    });

    return {
      uploadUrl,
      objectKey,
      bucket,
      isPrivate: rule.isPrivate,
      publicUrl: rule.isPrivate ? null : `${this.publicBaseUrl}/${objectKey}`,
      contentType: normalizedMime,
      expiresInSeconds: PRESIGN_UPLOAD_TTL_SECONDS,
    };
  }

  async createPrivateReadUrl(
    tenantId: string,
    objectKey: string,
  ): Promise<PresignDownloadResponseDto> {
    const cleanKey = objectKey.trim().replace(/^\/+/, '');
    const requiredPrefix = `tenants/${tenantId}/`;

    if (!cleanKey.startsWith(requiredPrefix) || cleanKey.includes('..')) {
      throw new ForbiddenException({
        code: 'STORAGE_CROSS_TENANT_FORBIDDEN',
        message: 'No tienes autorización para acceder a un archivo fuera del ámbito de tu tienda.',
      });
    }

    const command = new GetObjectCommand({
      Bucket: this.privateBucket,
      Key: cleanKey,
    });

    const downloadUrl = await getSignedUrl(this.s3Client, command, {
      expiresIn: PRESIGN_PRIVATE_READ_TTL_SECONDS,
    });

    return {
      downloadUrl,
      objectKey: cleanKey,
      expiresInSeconds: PRESIGN_PRIVATE_READ_TTL_SECONDS,
    };
  }

  private async ensureBucketExists(bucket: string): Promise<void> {
    try {
      await this.s3Client.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch {
      try {
        await this.s3Client.send(new CreateBucketCommand({ Bucket: bucket }));
        this.logger.log(`Bucket S3 asegurado: ${bucket}`);
      } catch (createErr) {
        const msg = createErr instanceof Error ? createErr.message : String(createErr);
        this.logger.warn(`No se pudo inicializar el bucket S3 "${bucket}": ${msg}`);
      }
    }
  }
}
