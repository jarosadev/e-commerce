export enum StorageUploadScope {
  CATALOG = 'catalog',
  BRANDING = 'branding',
  RECEIPT = 'receipt',
}

export interface StorageScopeRule {
  isPrivate: boolean;
  maxBytes: number;
  allowedMimeTypes: ReadonlyMap<string, string>;
}

const IMAGE_MIME_MAP = new Map<string, string>([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);

const BRANDING_MIME_MAP = new Map<string, string>([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/svg+xml', 'svg'],
  ['image/x-icon', 'ico'],
]);

const RECEIPT_MIME_MAP = new Map<string, string>([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['application/pdf', 'pdf'],
]);

export const STORAGE_SCOPE_RULES: Record<StorageUploadScope, StorageScopeRule> = {
  [StorageUploadScope.CATALOG]: {
    isPrivate: false,
    maxBytes: 5 * 1024 * 1024, // 5 MB
    allowedMimeTypes: IMAGE_MIME_MAP,
  },
  [StorageUploadScope.BRANDING]: {
    isPrivate: false,
    maxBytes: 2 * 1024 * 1024, // 2 MB
    allowedMimeTypes: BRANDING_MIME_MAP,
  },
  [StorageUploadScope.RECEIPT]: {
    isPrivate: true,
    maxBytes: 8 * 1024 * 1024, // 8 MB
    allowedMimeTypes: RECEIPT_MIME_MAP,
  },
};

export const PRESIGN_UPLOAD_TTL_SECONDS = 300; // 5 minutos
export const PRESIGN_PRIVATE_READ_TTL_SECONDS = 300; // 5 minutos (RNF-04)
