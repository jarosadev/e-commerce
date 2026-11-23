import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CustomerTier, StorePaymentType } from '@prisma/client';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { StockAdjustmentMode } from '../src/modules/catalog/dto/catalog.dto';
import { StorageUploadScope } from '../src/modules/storage/storage.constants';

describe('Phase 3: Storage, Catalog B2C/B2B, Variants, Inventory & Store Ops (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let owner1Cookie: string[];
  let owner2Cookie: string[];
  let createdCategoryId: string | null = null;
  let createdProductId: string | null = null;
  let createdPaymentMethodId: string | null = null;
  let createdShippingZoneId: string | null = null;

  const tenant1Slug = 'moda-mayorista';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();

    prisma = app.get(PrismaService);

    // Owner 1 (Carlos - owns moda-mayorista)
    const login1 = await request(app.getHttpServer())
      .post('/api/v1/auth/platform/login')
      .send({ email: 'carlos@urbanthreads.local', password: 'Owner1234!' })
      .expect(200);
    owner1Cookie = login1.headers['set-cookie'] as unknown as string[];

    // Owner 2 (Lucía - owns electro-hogar, NOT moda-mayorista)
    const login2 = await request(app.getHttpServer())
      .post('/api/v1/auth/platform/login')
      .send({ email: 'lucia@electrohogar.local', password: 'Owner1234!' })
      .expect(200);
    owner2Cookie = login2.headers['set-cookie'] as unknown as string[];
  });

  afterAll(async () => {
    if (createdProductId) {
      await prisma.product.deleteMany({ where: { id: createdProductId } });
    }
    if (createdCategoryId) {
      await prisma.category.deleteMany({ where: { id: createdCategoryId } });
    }
    if (createdPaymentMethodId) {
      await prisma.storePaymentMethod.deleteMany({ where: { id: createdPaymentMethodId } });
    }
    if (createdShippingZoneId) {
      await prisma.shippingZone.deleteMany({ where: { id: createdShippingZoneId } });
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
    await app.close();
  });

  it('issues Presigned PUT/GET URLs with MIME/size validation and blocks cross-tenant access', async () => {
    const uploadRes = await request(app.getHttpServer())
      .post('/api/v1/storage/presign-upload')
      .set('Cookie', owner1Cookie)
      .set('x-tenant-slug', tenant1Slug)
      .send({
        scope: StorageUploadScope.CATALOG,
        contentType: 'image/webp',
        sizeBytes: 120000,
      })
      .expect(201);

    expect(uploadRes.body.isPrivate).toBe(false);
    expect(uploadRes.body.publicUrl).toContain('catalog-public');
    expect(uploadRes.body.uploadUrl).toContain('X-Amz-Signature');

    // Disallowed MIME rejected
    await request(app.getHttpServer())
      .post('/api/v1/storage/presign-upload')
      .set('Cookie', owner1Cookie)
      .set('x-tenant-slug', tenant1Slug)
      .send({
        scope: StorageUploadScope.CATALOG,
        contentType: 'text/html',
        sizeBytes: 1000,
      })
      .expect(400);

    // Private receipt upload + private read URL
    const receiptRes = await request(app.getHttpServer())
      .post('/api/v1/storage/presign-upload')
      .set('Cookie', owner1Cookie)
      .set('x-tenant-slug', tenant1Slug)
      .send({
        scope: StorageUploadScope.RECEIPT,
        contentType: 'application/pdf',
        sizeBytes: 300000,
      })
      .expect(201);
    expect(receiptRes.body.isPrivate).toBe(true);
    expect(receiptRes.body.publicUrl).toBeNull();

    const downloadRes = await request(app.getHttpServer())
      .post('/api/v1/storage/presign-download')
      .set('Cookie', owner1Cookie)
      .set('x-tenant-slug', tenant1Slug)
      .send({ objectKey: receiptRes.body.objectKey })
      .expect(200);
    expect(downloadRes.body.expiresInSeconds).toBe(300);

    // Cross-tenant object key blocked
    await request(app.getHttpServer())
      .post('/api/v1/storage/presign-download')
      .set('Cookie', owner1Cookie)
      .set('x-tenant-slug', tenant1Slug)
      .send({ objectKey: 'tenants/other-tenant-uuid/receipt/secret.pdf' })
      .expect(403);
  });

  it('manages categories, products, matrix variants, atomic stock, low-stock alerts and wholesale B2B tiers', async () => {
    const suffix = Date.now();

    // 1. Create Category
    const catRes = await request(app.getHttpServer())
      .post('/api/v1/catalog/categories')
      .set('Cookie', owner1Cookie)
      .set('x-tenant-slug', tenant1Slug)
      .send({ name: `Cápsula Fase 3 ${suffix}`, sortOrder: 10 })
      .expect(201);
    createdCategoryId = catRes.body.id as string;

    // 2. Create Product with images
    const prodRes = await request(app.getHttpServer())
      .post('/api/v1/catalog/products')
      .set('Cookie', owner1Cookie)
      .set('x-tenant-slug', tenant1Slug)
      .send({
        name: `Chaqueta Bomber B2B ${suffix}`,
        categoryId: createdCategoryId,
        brand: 'Urban Threads',
        minOrderQty: 1,
        images: [
          {
            url: 'https://images.unsplash.com/photo-1551028719-00167b16eac5?w=800',
            altText: 'Bomber Negra',
          },
        ],
      })
      .expect(201);
    createdProductId = prodRes.body.id as string;

    // 3. Matrix Variant Generator (2 tallas x 2 colores = 4 variants)
    const matrixRes = await request(app.getHttpServer())
      .post(`/api/v1/catalog/products/${createdProductId}/variants/matrix`)
      .set('Cookie', owner1Cookie)
      .set('x-tenant-slug', tenant1Slug)
      .send({
        skuPrefix: `BMB${String(suffix).slice(-4)}`,
        axes: [
          { name: 'talla', values: ['M', 'L'] },
          { name: 'color', values: ['Negro', 'Oliva'] },
        ],
        retailPrice: 75,
        stockOnHand: 3,
        lowStockThreshold: 5,
      })
      .expect(201);
    expect(matrixRes.body.createdCount).toBe(4);
    expect(matrixRes.body.skippedCount).toBe(0);

    const firstVariantId = matrixRes.body.variants[0].id as string;

    // 4. Atomic stock adjustment (DELTA +7 -> 10, then simulate reserved=6 and verify SET 4 fails 409)
    const stockUp = await request(app.getHttpServer())
      .patch(`/api/v1/catalog/variants/${firstVariantId}/stock`)
      .set('Cookie', owner1Cookie)
      .set('x-tenant-slug', tenant1Slug)
      .send({ mode: StockAdjustmentMode.DELTA, quantity: 7 })
      .expect(200);
    expect(stockUp.body.stockOnHand).toBe(10);

    await prisma.productVariant.update({
      where: { id: firstVariantId },
      data: { stockReserved: 6 },
    });

    await request(app.getHttpServer())
      .patch(`/api/v1/catalog/variants/${firstVariantId}/stock`)
      .set('Cookie', owner1Cookie)
      .set('x-tenant-slug', tenant1Slug)
      .send({ mode: StockAdjustmentMode.SET, quantity: 4 })
      .expect(409);

    // 5. Low-stock alerts includes our newly created variants (stockOnHand=3 <= threshold=5)
    const lowStockRes = await request(app.getHttpServer())
      .get('/api/v1/catalog/inventory/low-stock')
      .set('Cookie', owner1Cookie)
      .set('x-tenant-slug', tenant1Slug)
      .expect(200);
    expect(lowStockRes.body.totalAlerts).toBeGreaterThanOrEqual(4);

    // 6. Wholesale B2B Tiers: reject overlapping, then persist valid tiers
    await request(app.getHttpServer())
      .put(`/api/v1/catalog/products/${createdProductId}/wholesale-tiers`)
      .set('Cookie', owner1Cookie)
      .set('x-tenant-slug', tenant1Slug)
      .send({
        tiers: [
          { minQuantity: 6, maxQuantity: 15, unitPrice: 60 },
          { minQuantity: 12, maxQuantity: null, unitPrice: 52 },
        ],
      })
      .expect(400);

    const tiersRes = await request(app.getHttpServer())
      .put(`/api/v1/catalog/products/${createdProductId}/wholesale-tiers`)
      .set('Cookie', owner1Cookie)
      .set('x-tenant-slug', tenant1Slug)
      .send({
        tiers: [
          { minQuantity: 6, maxQuantity: 11, unitPrice: 60, label: 'Media Docena' },
          { minQuantity: 12, maxQuantity: null, unitPrice: 50, label: 'Mayorista 12+' },
        ],
      })
      .expect(200);
    expect(tiersRes.body.length).toBe(2);

    // 7. Storefront exposes images & wholesaleTiers publicly
    const publicProduct = await request(app.getHttpServer())
      .get(`/api/v1/storefront/products/${prodRes.body.slug as string}`)
      .set('x-tenant-slug', tenant1Slug)
      .expect(200);
    expect(publicProduct.body.images.length).toBe(1);
    expect(publicProduct.body.wholesaleTiers.length).toBe(2);
  });

  it('manages store settings, manual payment methods, shipping zones, B2B customer tiers and enforces tenant RBAC', async () => {
    // Update tenant operational settings
    const settingsRes = await request(app.getHttpServer())
      .patch('/api/v1/tenants/current/settings')
      .set('Cookie', owner1Cookie)
      .set('x-tenant-slug', tenant1Slug)
      .send({ minWholesaleQty: 6, minWholesaleAmount: 120, stockReservationMins: 90 })
      .expect(200);
    expect(settingsRes.body.stockReservationMins).toBe(90);

    // Create manual payment method
    const pmRes = await request(app.getHttpServer())
      .post('/api/v1/store-ops/payment-methods')
      .set('Cookie', owner1Cookie)
      .set('x-tenant-slug', tenant1Slug)
      .send({
        type: StorePaymentType.BANK_TRANSFER,
        title: `Cuenta Fase 3 ${Date.now()}`,
        accountDetailsJson: { banco: 'Banco Prueba', alias: 'URBAN.FASE3' },
        requiresReceipt: true,
      })
      .expect(201);
    createdPaymentMethodId = pmRes.body.id as string;

    // Create shipping zone
    const szRes = await request(app.getHttpServer())
      .post('/api/v1/store-ops/shipping-zones')
      .set('Cookie', owner1Cookie)
      .set('x-tenant-slug', tenant1Slug)
      .send({
        name: `Zona Interior Fase 3 ${Date.now()}`,
        cities: ['Rosario', 'Córdoba'],
        flatRate: 12.5,
        freeShippingThreshold: 180,
        estimatedDays: '3 a 5 días',
      })
      .expect(201);
    createdShippingZoneId = szRes.body.id as string;
    expect(szRes.body.flatRate).toBe(12.5);

    // List customers & toggle tier RETAIL <-> WHOLESALE_B2B
    const customersRes = await request(app.getHttpServer())
      .get('/api/v1/store-ops/customers')
      .set('Cookie', owner1Cookie)
      .set('x-tenant-slug', tenant1Slug)
      .expect(200);
    expect(customersRes.body.items.length).toBeGreaterThanOrEqual(1);
    const customerId = customersRes.body.items[0].id as string;

    const updatedCust = await request(app.getHttpServer())
      .patch(`/api/v1/store-ops/customers/${customerId}/tier`)
      .set('Cookie', owner1Cookie)
      .set('x-tenant-slug', tenant1Slug)
      .send({ customerTier: CustomerTier.WHOLESALE_B2B })
      .expect(200);
    expect(updatedCust.body.customerTier).toBe(CustomerTier.WHOLESALE_B2B);

    // Cross-tenant RBAC: Owner 2 (Lucía) CANNOT read or edit Carlos's store catalog or store-ops!
    await request(app.getHttpServer())
      .get('/api/v1/catalog/products')
      .set('Cookie', owner2Cookie)
      .set('x-tenant-slug', tenant1Slug)
      .expect(403);

    await request(app.getHttpServer())
      .get('/api/v1/store-ops/payment-methods')
      .set('Cookie', owner2Cookie)
      .set('x-tenant-slug', tenant1Slug)
      .expect(403);
  });
});
