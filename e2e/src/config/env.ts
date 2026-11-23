import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function loadDotEnvIfPresent(): void {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) {
    return;
  }
  const content = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const eqIdx = line.indexOf('=');
    if (eqIdx <= 0) {
      continue;
    }
    const key = line.slice(0, eqIdx).trim();
    let value = line.slice(eqIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadDotEnvIfPresent();

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

export const ENV = {
  backendUrl: stripTrailingSlash(process.env.BACKEND_URL ?? 'http://localhost:4000'),
  frontendUrl: stripTrailingSlash(process.env.FRONTEND_URL ?? 'http://localhost:3000'),
  mailpitUrl: stripTrailingSlash(process.env.MAILPIT_URL ?? 'http://localhost:8025'),
  platformBaseDomain: process.env.PLATFORM_BASE_DOMAIN ?? 'localhost:3000',
} as const;

export const ENDPOINTS = {
  apiBaseUrl: `${ENV.backendUrl}/api/v1`,
  openApiJsonUrl: `${ENV.backendUrl}/api/docs-json`,
  swaggerDocsUrl: `${ENV.backendUrl}/api/docs`,
  mailpitApiUrl: `${ENV.mailpitUrl}/api/v1`,
} as const;

export const SEED_USERS = {
  superAdmin: {
    email: 'admin@vendexa.local',
    password: 'Admin1234!',
    role: 'SUPER_ADMIN',
  },
  owner1: {
    email: 'carlos@urbanthreads.local',
    password: 'Owner1234!',
    role: 'STORE_OWNER',
    fullName: 'Carlos Mendoza',
    legalName: 'Urban Threads Textil S.R.L.',
    tenantSlug: 'moda-mayorista',
  },
  owner2: {
    email: 'lucia@electrohogar.local',
    password: 'Owner1234!',
    role: 'STORE_OWNER',
    fullName: 'Lucía Paredes',
    legalName: 'ElectroHogar Importaciones S.A.',
    tenantSlug: 'electro-hogar',
  },
  customer1: {
    email: 'comprador@cliente.local',
    password: 'Buyer1234!',
    fullName: 'Sofía Ramírez (Distribuidora)',
    customerTier: 'WHOLESALE_B2B',
    tenantSlug: 'moda-mayorista',
  },
} as const;

export const SEED_TENANTS = {
  modaMayorista: {
    slug: 'moda-mayorista',
    host: `moda-mayorista.${ENV.platformBaseDomain}`,
    name: 'Urban Threads Studio',
    status: 'ACTIVE',
    planCode: 'CRECIMIENTO_PRO',
    minWholesaleQty: 6,
    minWholesaleAmount: 120,
    theme: {
      primaryColor: '#0F172A',
      accentColor: '#4F46E5',
      darkModeDefault: false,
      heroTitle: 'Colección cápsula B2C & Mayorista 2026',
      heroSubtitle:
        'Combina tallas y colores: precios mayoristas automáticos desde 6 unidades en tu carrito.',
      announcementText:
        'Envío gratis en compras mayores a 120 USD · Descuentos por volumen activados en vivo',
    },
  },
  electroHogar: {
    slug: 'electro-hogar',
    host: `electro-hogar.${ENV.platformBaseDomain}`,
    name: 'ElectroHogar Directo',
    status: 'TRIAL',
    planCode: 'EMPRENDEDOR',
    theme: {
      primaryColor: '#09090B',
      accentColor: '#0EA5E9',
      darkModeDefault: false,
      heroTitle: 'Tecnología para tu hogar al mejor precio directo',
      heroSubtitle: 'Envíos asegurados a todo el país.',
    },
  },
} as const;

export const SEED_PLANS = {
  EMPRENDEDOR: {
    code: 'EMPRENDEDOR',
    priceMonthly: 19,
    priceYearly: 190,
    maxProducts: 100,
    maxStaff: 1,
  },
  CRECIMIENTO_PRO: {
    code: 'CRECIMIENTO_PRO',
    priceMonthly: 49,
    priceYearly: 490,
    maxProducts: 1500,
    maxStaff: 3,
  },
  MAYORISTA_ENTERPRISE: {
    code: 'MAYORISTA_ENTERPRISE',
    priceMonthly: 99,
    priceYearly: 990,
    maxProducts: 50000,
    maxStaff: 10,
  },
} as const;

export const SEED_PRODUCTS = {
  hoodie: {
    slug: 'hoodie-boxy-heavyweight-450gsm',
    name: 'Hoodie Boxy Heavyweight 450gsm',
    categorySlug: 'hoodies-poleras',
    retailPrice: 42,
    tiers: [
      { minQuantity: 6, maxQuantity: 11, unitPrice: 33 },
      { minQuantity: 12, maxQuantity: null, unitPrice: 26.5 },
    ],
    skus: {
      blkM: 'UT-HD-BLK-M',
      blkL: 'UT-HD-BLK-L',
      sndL: 'UT-HD-SND-L',
    },
  },
  sneaker: {
    slug: 'sneaker-minimal-court-leather',
    name: 'Sneaker Minimal Court Leather',
    categorySlug: 'calzado-urbano',
    retailPrice: 68,
    tiers: [
      { minQuantity: 6, maxQuantity: 17, unitPrice: 54 },
      { minQuantity: 18, maxQuantity: null, unitPrice: 46 },
    ],
    skus: {
      wht41: 'UT-SNK-WHT-41',
      wht42: 'UT-SNK-WHT-42',
    },
  },
  backpack: {
    slug: 'mochila-commuter-impermeable-24l',
    name: 'Mochila Commuter Impermeable 24L',
    categorySlug: 'accesorios-mochilas',
    retailPrice: 55,
    tiers: [
      { minQuantity: 5, maxQuantity: 14, unitPrice: 43 },
      { minQuantity: 15, maxQuantity: null, unitPrice: 36 },
    ],
    skus: {
      grf: 'UG-BP-24L-GRF',
    },
  },
} as const;

export const SEED_COUPONS = {
  bienvenida10: {
    code: 'BIENVENIDA10',
    discountType: 'PERCENTAGE',
    value: 10,
    minPurchaseAmount: 50,
  },
} as const;

export function uniqueId(prefix = 'e2e'): string {
  const rand = crypto.randomBytes(4).toString('hex');
  return `${prefix}-${Date.now()}-${rand}`;
}

export function uniqueEmail(prefix = 'user'): string {
  return `${uniqueId(prefix).toLowerCase()}@test.local`;
}

export function uniqueSlug(prefix = 'tienda'): string {
  return `${uniqueId(prefix).toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;
}
