import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  PLATFORM_NAME: z.string().default('Vendexa SaaS'),
  PLATFORM_BASE_DOMAIN: z.string().default('localhost:3000'),
  FRONTEND_URL: z.string().default('http://localhost:3000'),
  BACKEND_URL: z.string().default('http://localhost:4000'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL es obligatorio'),

  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional().default(''),

  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  OAUTH_STATE_SECRET: z.string().min(16),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().default(30),

  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  GOOGLE_CALLBACK_URL: z.string().default('http://localhost:4000/api/v1/auth/google/callback'),

  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().default(1025),
  SMTP_SECURE: z
    .union([z.boolean(), z.string()])
    .default(false)
    .transform((v) => (typeof v === 'boolean' ? v : v.toLowerCase() === 'true')),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASS: z.string().optional().default(''),
  MAIL_FROM_NAME: z.string().default('Vendexa E-Commerce'),
  MAIL_FROM_ADDRESS: z.string().default('no-reply@vendexa.local'),

  S3_ENDPOINT: z.string().default('http://localhost:9000'),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY: z.string().default('any'),
  S3_SECRET_KEY: z.string().default('any'),
  S3_PUBLIC_BUCKET: z.string().default('catalog-public'),
  S3_PRIVATE_BUCKET: z.string().default('receipts-private'),
  S3_PUBLIC_BASE_URL: z.string().default('http://localhost:9000/catalog-public'),
});

export type EnvConfig = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): EnvConfig {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    console.error('Variables de entorno inválidas:', parsed.error.flatten().fieldErrors);
    throw new Error('Fallo en validación de variables de entorno.');
  }
  return parsed.data;
}

const GOOGLE_OAUTH_PLACEHOLDER_PATTERNS = [
  /^your[-_]?google[-_]?client[-_]?(id|secret)/i,
  /^(placeholder|changeme|replace[-_]?me|todo|example|<[^>]+>)$/i,
  /^example[-_]/i,
];

function isPlaceholderCredential(value: string | undefined): boolean {
  if (!value) return true;
  const trimmed = value.trim();
  if (!trimmed) return true;
  return GOOGLE_OAUTH_PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export function isGoogleOAuthConfigured(
  config: Pick<EnvConfig, 'GOOGLE_CLIENT_ID' | 'GOOGLE_CLIENT_SECRET'>,
): boolean {
  return (
    !isPlaceholderCredential(config.GOOGLE_CLIENT_ID) &&
    !isPlaceholderCredential(config.GOOGLE_CLIENT_SECRET)
  );
}
