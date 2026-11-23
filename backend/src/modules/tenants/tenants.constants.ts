export const RESERVED_TENANT_SLUGS = new Set([
  'admin',
  'panel',
  'api',
  'auth',
  'www',
  'superadmin',
  'dashboard',
  'login',
  'register',
  'verify-otp',
  'forgot-password',
  'reset-password',
  'health',
  'static',
  'assets',
  'cdn',
  'mail',
  'app',
  'store',
  'docs',
]);

export const TENANT_SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const HEX_COLOR_REGEX = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;
export const TRIAL_DAYS = 14;
