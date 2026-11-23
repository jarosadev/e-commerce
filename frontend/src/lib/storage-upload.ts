import apiClient from './api-client';

export type UploadScope = 'catalog' | 'branding' | 'receipt';

export interface UploadedFileResult {
  objectKey: string;
  publicUrl: string | null;
}

export async function uploadFileViaPresignedUrl(
  tenantSlug: string,
  scope: UploadScope,
  file: File,
): Promise<UploadedFileResult> {
  const presignRes = await apiClient.post<{
    uploadUrl: string;
    objectKey: string;
    publicUrl: string | null;
    contentType: string;
  }>(
    '/storage/presign-upload',
    {
      scope,
      contentType: file.type || 'image/jpeg',
      sizeBytes: file.size,
      originalFilename: file.name,
    },
    { headers: { 'x-tenant-slug': tenantSlug } },
  );

  const putRes = await fetch(presignRes.data.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': presignRes.data.contentType },
    body: file,
  });

  if (!putRes.ok) {
    throw new Error(`Error al subir el archivo al almacenamiento S3 (${putRes.status}).`);
  }

  return {
    objectKey: presignRes.data.objectKey,
    publicUrl: presignRes.data.publicUrl,
  };
}
