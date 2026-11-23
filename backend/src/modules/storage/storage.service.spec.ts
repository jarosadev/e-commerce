import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvConfig } from '../../config/env.validation';
import { StorageUploadScope } from './storage.constants';
import { StorageService } from './storage.service';

describe('StorageService', () => {
  let service: StorageService;

  beforeEach(() => {
    const config = {
      get: jest.fn((key: keyof EnvConfig) => {
        const defaults: Record<string, unknown> = {
          NODE_ENV: 'test',
          S3_ENDPOINT: 'http://localhost:9000',
          S3_REGION: 'us-east-1',
          S3_ACCESS_KEY: 'test-key',
          S3_SECRET_KEY: 'test-secret',
          S3_PUBLIC_BUCKET: 'catalog-public',
          S3_PRIVATE_BUCKET: 'receipts-private',
          S3_PUBLIC_BASE_URL: 'http://localhost:9000/catalog-public',
        };
        return defaults[key];
      }),
    } as unknown as ConfigService<EnvConfig, true>;

    service = new StorageService(config);
  });

  it('generates public Presigned PUT URL for catalog images and private URL for receipts', async () => {
    const catalogRes = await service.createPresignedUploadUrl('tenant-123', {
      scope: StorageUploadScope.CATALOG,
      contentType: 'image/webp',
      sizeBytes: 250_000,
    });

    expect(catalogRes.bucket).toBe('catalog-public');
    expect(catalogRes.isPrivate).toBe(false);
    expect(catalogRes.objectKey).toMatch(/^tenants\/tenant-123\/catalog\/.+\.webp$/);
    expect(catalogRes.publicUrl).toBe(
      `http://localhost:9000/catalog-public/${catalogRes.objectKey}`,
    );
    expect(catalogRes.uploadUrl).toContain('catalog-public');

    const receiptRes = await service.createPresignedUploadUrl('tenant-123', {
      scope: StorageUploadScope.RECEIPT,
      contentType: 'application/pdf',
      sizeBytes: 600_000,
    });

    expect(receiptRes.bucket).toBe('receipts-private');
    expect(receiptRes.isPrivate).toBe(true);
    expect(receiptRes.publicUrl).toBeNull();
    expect(receiptRes.objectKey).toMatch(/^tenants\/tenant-123\/receipt\/.+\.pdf$/);
  });

  it('rejects disallowed MIME types and oversized files', async () => {
    await expect(
      service.createPresignedUploadUrl('tenant-123', {
        scope: StorageUploadScope.CATALOG,
        contentType: 'application/javascript',
        sizeBytes: 1024,
      }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.createPresignedUploadUrl('tenant-123', {
        scope: StorageUploadScope.BRANDING,
        contentType: 'image/png',
        sizeBytes: 10 * 1024 * 1024, // 10MB > 2MB
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('prevents cross-tenant private read URL generation and path traversal', async () => {
    const allowed = await service.createPrivateReadUrl(
      'tenant-a',
      'tenants/tenant-a/receipts/file-1.pdf',
    );
    expect(allowed.downloadUrl).toContain('receipts-private');
    expect(allowed.expiresInSeconds).toBe(300);

    await expect(
      service.createPrivateReadUrl('tenant-a', 'tenants/tenant-b/receipts/file-1.pdf'),
    ).rejects.toThrow(ForbiddenException);

    await expect(
      service.createPrivateReadUrl('tenant-a', 'tenants/tenant-a/../tenant-b/receipts/file-1.pdf'),
    ).rejects.toThrow(ForbiddenException);
  });
});
