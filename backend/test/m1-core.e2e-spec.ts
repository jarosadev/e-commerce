import { Controller, Get, INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { TenantStatus } from '@prisma/client';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuthenticatedUserContext, ResolvedTenantContext } from '../src/common/cls/cls.types';
import { CurrentTenant } from '../src/common/decorators/current-tenant.decorator';
import { CurrentUser } from '../src/common/decorators/current-user.decorator';
import { Public } from '../src/common/decorators/public.decorator';
import { TenantResolutionService } from '../src/common/services/tenant-resolution.service';
import { CrossTenantAccessError, PrismaService } from '../src/database/prisma.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { RedisService } from '../src/redis/redis.module';

@Controller('__m1-probe')
class M1TenantProbeController {
  @Get('tenant')
  @Public()
  getTenant(@CurrentTenant() tenant?: ResolvedTenantContext) {
    return {
      resolved: Boolean(tenant),
      tenant: tenant ?? null,
    };
  }

  @Get('protected-customer')
  getProtectedCustomer(
    @CurrentTenant() tenant?: ResolvedTenantContext,
    @CurrentUser() user?: AuthenticatedUserContext,
  ) {
    return {
      tenantId: tenant?.id ?? null,
      tenantSlug: tenant?.slug ?? null,
      user: user ?? null,
    };
  }
}

interface MailpitListResponse {
  total: number;
  messages: Array<{
    ID: string;
    Subject: string;
    To: Array<{ Address: string }>;
    From: { Address: string };
  }>;
}

interface MailpitDetailResponse {
  ID: string;
  Subject: string;
  Text: string;
  HTML: string;
  From: { Name: string; Address: string };
  To: Array<{ Address: string }>;
}

const MAILPIT_URL = 'http://localhost:8025';

async function waitForMailpitMessages(
  expectedCount: number,
  timeoutMs = 8000,
): Promise<MailpitListResponse> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${MAILPIT_URL}/api/v1/messages`);
    const body = (await res.json()) as MailpitListResponse;
    if (body.messages.length >= expectedCount) {
      return body;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Mailpit no recibió ${expectedCount} correos en ${timeoutMs}ms.`);
}

describe('M1 Core Infrastructure (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let jwtService: JwtService;
  let tenantResolutionService: TenantResolutionService;
  let notificationsService: NotificationsService;
  const cleanupTenantIds: string[] = [];
  const cleanupCartIds: string[] = [];
  const cleanupOrderIds: string[] = [];
  const cleanupProductIds: string[] = [];
  const cleanupSubscriptionPaymentIds: string[] = [];
  const cleanupRedisKeys: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [M1TenantProbeController],
    }).compile();

    app = moduleRef.createNestApplication();
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
    redis = app.get(RedisService);
    jwtService = app.get(JwtService);
    tenantResolutionService = app.get(TenantResolutionService);
    notificationsService = app.get(NotificationsService);
  });

  afterAll(async () => {
    if (cleanupSubscriptionPaymentIds.length > 0) {
      await prisma.subscriptionPayment.deleteMany({
        where: { id: { in: cleanupSubscriptionPaymentIds } },
      });
    }
    if (cleanupOrderIds.length > 0) {
      await prisma.order.deleteMany({ where: { id: { in: cleanupOrderIds } } });
    }
    if (cleanupCartIds.length > 0) {
      await prisma.cart.deleteMany({ where: { id: { in: cleanupCartIds } } });
    }
    if (cleanupProductIds.length > 0) {
      await prisma.product.deleteMany({ where: { id: { in: cleanupProductIds } } });
    }
    if (cleanupTenantIds.length > 0) {
      await prisma.tenant.deleteMany({ where: { id: { in: cleanupTenantIds } } });
    }
    if (cleanupRedisKeys.length > 0) {
      await Promise.all(cleanupRedisKeys.map((k) => redis.del(k)));
    }
    await redis.delByPattern('tenant:host:*');
    await redis.delByPattern('tenant:slug:*');
    await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: 'DELETE' }).catch(() => undefined);
    await app.close();
  });

  it('GET /api/v1/health returns 200 when up and 503 preserving HealthResponseDto when a dependency is down', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(res.body).toMatchObject({
      status: 'ok',
      db: 'up',
      redis: 'up',
    });
    expect(typeof res.body.timestamp).toBe('string');

    const querySpy = jest
      .spyOn(prisma, '$queryRaw')
      .mockRejectedValueOnce(new Error('Simulated DB outage'));
    try {
      const degraded = await request(app.getHttpServer()).get('/api/v1/health').expect(503);
      expect(degraded.body).toMatchObject({
        status: 'error',
        db: 'down',
        redis: 'up',
      });
      expect(typeof degraded.body.timestamp).toBe('string');
      expect(degraded.body.message).toBeUndefined();
    } finally {
      querySpy.mockRestore();
    }
  });

  it('returns RFC 7807 formatted error JSON on 404', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/does-not-exist').expect(404);
    expect(res.body).toMatchObject({
      status: 404,
      statusCode: 404,
      error: 'Not Found',
      path: '/api/v1/does-not-exist',
    });
    expect(typeof res.body.timestamp).toBe('string');
    expect(typeof res.body.requestId).toBe('string');
  });

  it('resolves tenant by x-tenant-host (with Redis cache) and x-tenant-slug, and blocks SUSPENDED tenants', async () => {
    await redis.del('tenant:host:moda-mayorista.localhost');
    await redis.del('tenant:slug:electro-hogar');

    const resHost = await request(app.getHttpServer())
      .get('/api/v1/__m1-probe/tenant')
      .set('x-tenant-host', 'moda-mayorista.localhost:3000')
      .expect(200);

    expect(resHost.body.resolved).toBe(true);
    expect(resHost.body.tenant).toMatchObject({
      slug: 'moda-mayorista',
      status: TenantStatus.ACTIVE,
    });

    const cachedRaw = await redis.get('tenant:host:moda-mayorista.localhost');
    expect(cachedRaw).not.toBeNull();
    const cachedTtl = await redis.ttl('tenant:host:moda-mayorista.localhost');
    expect(cachedTtl).toBeGreaterThan(0);

    const resSlug = await request(app.getHttpServer())
      .get('/api/v1/__m1-probe/tenant')
      .set('x-tenant-slug', 'electro-hogar')
      .expect(200);

    expect(resSlug.body.resolved).toBe(true);
    expect(resSlug.body.tenant).toMatchObject({
      slug: 'electro-hogar',
      status: TenantStatus.TRIAL,
    });

    const owner = await prisma.platformUser.findFirstOrThrow();
    const suspendedSlug = `suspended-e2e-${Date.now()}`;
    const suspendedTenant = await prisma.tenant.create({
      data: {
        slug: suspendedSlug,
        name: 'Suspended Store E2E',
        ownerId: owner.id,
        status: TenantStatus.SUSPENDED,
      },
    });
    cleanupTenantIds.push(suspendedTenant.id);

    const resSuspended = await request(app.getHttpServer())
      .get('/api/v1/__m1-probe/tenant')
      .set('x-tenant-host', `${suspendedSlug}.localhost:3000`)
      .expect(403);

    expect(resSuspended.body).toMatchObject({
      statusCode: 403,
      code: 'TENANT_SUSPENDED',
    });

    // Reserved platform subdomain must NOT fall back to x-tenant-slug
    const resReservedSpoof = await request(app.getHttpServer())
      .get('/api/v1/__m1-probe/tenant')
      .set('x-tenant-host', 'admin.localhost:3000')
      .set('x-tenant-slug', 'moda-mayorista')
      .expect(200);
    expect(resReservedSpoof.body).toEqual({ resolved: false, tenant: null });

    // Cache invalidation helper clears cached host & slug keys
    await tenantResolutionService.invalidateTenantCache('moda-mayorista');
    await expect(redis.get('tenant:host:moda-mayorista.localhost')).resolves.toBeNull();
  });

  it('JwtAuthGuard pre-resolves tenant and rejects cross-tenant CUSTOMER JWT (Bearer & Cookie) on protected routes', async () => {
    const store1 = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'moda-mayorista' } });
    const store1Customer = await prisma.storeCustomer.findFirstOrThrow({
      where: { tenantId: store1.id },
    });

    const customerToken = await jwtService.signAsync({
      sub: store1Customer.id,
      email: store1Customer.email,
      actorType: 'CUSTOMER',
      role: 'CUSTOMER',
      tenantId: store1.id,
    });

    const okBearer = await request(app.getHttpServer())
      .get('/api/v1/__m1-probe/protected-customer')
      .set('x-tenant-host', 'moda-mayorista.localhost:3000')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);
    expect(okBearer.body.tenantSlug).toBe('moda-mayorista');
    expect(okBearer.body.user.sub).toBe(store1Customer.id);

    const okCookie = await request(app.getHttpServer())
      .get('/api/v1/__m1-probe/protected-customer')
      .set('x-tenant-host', 'moda-mayorista.localhost:3000')
      .set('Cookie', [`access_token=${customerToken}`])
      .expect(200);
    expect(okCookie.body.tenantSlug).toBe('moda-mayorista');

    await request(app.getHttpServer())
      .get('/api/v1/__m1-probe/protected-customer')
      .set('x-tenant-host', 'electro-hogar.localhost:3000')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(401);

    await request(app.getHttpServer())
      .get('/api/v1/__m1-probe/protected-customer')
      .set('x-tenant-host', 'electro-hogar.localhost:3000')
      .set('Cookie', [`access_token=${customerToken}`])
      .expect(401);
  });

  it('RedisService.incrWithTtl atomically sets and repairs TTL via Lua script', async () => {
    const key = `e2e:ratelimit:${Date.now()}`;
    cleanupRedisKeys.push(key);

    await expect(redis.incrWithTtl(key, 120)).resolves.toBe(1);
    expect(await redis.ttl(key)).toBeGreaterThan(0);

    await redis.client.persist(key);
    expect(await redis.ttl(key)).toBe(-1);

    await expect(redis.incrWithTtl(key, 120)).resolves.toBe(2);
    expect(await redis.ttl(key)).toBeGreaterThan(0);
  });

  it('enforces real PostgreSQL cross-tenant isolation via PrismaService.forTenant', async () => {
    const store1 = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'moda-mayorista' } });
    const store2 = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'electro-hogar' } });

    const store1Product = await prisma.product.findFirstOrThrow({
      where: { tenantId: store1.id },
      include: { variants: true },
    });

    const db2 = prisma.forTenant(store2.id);

    await expect(db2.product.findMany()).resolves.toEqual([]);
    await expect(db2.product.count()).resolves.toBe(0);
    await expect(db2.product.findUnique({ where: { id: store1Product.id } })).resolves.toBeNull();
    await expect(
      db2.product.findUniqueOrThrow({ where: { id: store1Product.id } }),
    ).rejects.toThrow();

    await expect(
      db2.product.update({
        where: { id: store1Product.id },
        data: { name: 'CROSS_TENANT_HACK' },
      }),
    ).rejects.toThrow();

    await expect(
      db2.product.delete({
        where: { id: store1Product.id },
      }),
    ).rejects.toThrow();

    const untouched = await prisma.product.findUniqueOrThrow({
      where: { id: store1Product.id },
    });
    expect(untouched.name).toBe(store1Product.name);

    await expect(db2.storeTheme.findUnique({ where: { tenantId: store1.id } })).rejects.toThrow(
      CrossTenantAccessError,
    );

    const store1Cart = await prisma.cart.create({
      data: { tenantId: store1.id, guestToken: `guest-e2e-${Date.now()}` },
    });
    cleanupCartIds.push(store1Cart.id);

    await expect(
      db2.cartItem.create({
        data: {
          cartId: store1Cart.id,
          variantId: store1Product.variants[0].id,
          quantity: 1,
        },
      }),
    ).rejects.toThrow(CrossTenantAccessError);

    const store1Category = await prisma.category.findFirstOrThrow({
      where: { tenantId: store1.id },
    });
    const store1Customer = await prisma.storeCustomer.findFirstOrThrow({
      where: { tenantId: store1.id },
    });
    const suffix = Date.now();

    // Vector 5a: Nested create with foreign tenantId on ProductVariant
    await expect(
      db2.product.create({
        data: {
          tenantId: store2.id,
          name: `Attack 5a ${suffix}`,
          slug: `attack-5a-${suffix}`,
          variants: {
            create: [
              {
                tenantId: store1.id,
                sku: `ATK-5A-${suffix}`,
                title: 'Poisoned',
                attributes: {},
                retailPrice: 10,
              } as never,
            ],
          },
        },
      }),
    ).rejects.toThrow(CrossTenantAccessError);

    // Vector 5b: Nested child create (Cart -> CartItem) with store1 variantId
    await expect(
      db2.cart.create({
        data: {
          tenantId: store2.id,
          guestToken: `attack-5b-${suffix}`,
          items: {
            create: [{ variantId: store1Product.variants[0].id, quantity: 5 }],
          },
        },
      }),
    ).rejects.toThrow(CrossTenantAccessError);

    // Vector 5c: Nested connect (Category -> products.connect) mutating store1 Product
    await expect(
      db2.category.create({
        data: {
          tenantId: store2.id,
          name: `Attack 5c ${suffix}`,
          slug: `attack-5c-${suffix}`,
          products: {
            connect: [{ id: store1Product.id }],
          },
        },
      }),
    ).rejects.toThrow(CrossTenantAccessError);

    // Vector 5d: Direct cross-tenant scalar FK (WholesaleTier -> store1 Product)
    await expect(
      db2.wholesaleTier.create({
        data: {
          tenantId: store2.id,
          productId: store1Product.id,
          minQuantity: 1,
          unitPrice: 0.01,
          label: 'CROSS-TENANT-TIER',
        },
      }),
    ).rejects.toThrow(CrossTenantAccessError);

    // Vector 5e: Direct cross-tenant scalar FK (Product -> store1 Category)
    await expect(
      db2.product.create({
        data: {
          tenantId: store2.id,
          name: `Attack 5e ${suffix}`,
          slug: `attack-5e-${suffix}`,
          categoryId: store1Category.id,
        },
      }),
    ).rejects.toThrow(CrossTenantAccessError);

    // Vector 5f: Direct cross-tenant scalar FK (Cart -> store1 StoreCustomer)
    await expect(
      db2.cart.create({
        data: {
          tenantId: store2.id,
          customerId: store1Customer.id,
        },
      }),
    ).rejects.toThrow(CrossTenantAccessError);

    // Order equivalents: foreign customerId & nested OrderItem with foreign variantId
    await expect(
      db2.order.create({
        data: {
          tenantId: store2.id,
          orderNumber: `ATK-ORD-${suffix}`,
          customerId: store1Customer.id,
          checkoutChannel: 'MANUAL_PAYMENT',
          subtotal: 10,
          grandTotal: 10,
        },
      }),
    ).rejects.toThrow(CrossTenantAccessError);

    await expect(
      db2.order.create({
        data: {
          tenantId: store2.id,
          orderNumber: `ATK-ORD-ITEM-${suffix}`,
          checkoutChannel: 'MANUAL_PAYMENT',
          subtotal: 10,
          grandTotal: 10,
          items: {
            create: [
              {
                variantId: store1Product.variants[0].id,
                productNameSnapshot: 'Hack',
                variantTitleSnapshot: 'Hack',
                skuSnapshot: 'HACK',
                quantity: 1,
                unitPriceApplied: 10,
                lineTotal: 10,
              },
            ],
          },
        },
      }),
    ).rejects.toThrow(CrossTenantAccessError);

    // Verify store1 records remain untouched
    const store1ProductAfter = await prisma.product.findUniqueOrThrow({
      where: { id: store1Product.id },
      include: { variants: true, wholesaleTiers: true },
    });
    expect(store1ProductAfter.categoryId).toBe(store1Product.categoryId);
    expect(store1ProductAfter.variants.some((v) => v.sku === `ATK-5A-${suffix}`)).toBe(false);
    expect(store1ProductAfter.wholesaleTiers.some((t) => t.label === 'CROSS-TENANT-TIER')).toBe(
      false,
    );
  });

  it('enforces real PostgreSQL cross-tenant isolation on SubscriptionPayment via forTenant', async () => {
    const store1 = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'moda-mayorista' } });
    const store2 = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'electro-hogar' } });
    const store1Sub = await prisma.subscription.findUniqueOrThrow({
      where: { tenantId: store1.id },
    });
    const store2Sub = await prisma.subscription.findUniqueOrThrow({
      where: { tenantId: store2.id },
    });
    const store1Payment = await prisma.subscriptionPayment.findFirstOrThrow({
      where: { subscriptionId: store1Sub.id },
    });

    const db2 = prisma.forTenant(store2.id);
    const suffix = Date.now();

    // Cross-tenant reads blocked
    await expect(db2.subscriptionPayment.findMany()).resolves.toEqual([]);
    await expect(
      db2.subscriptionPayment.findUnique({ where: { id: store1Payment.id } }),
    ).resolves.toBeNull();

    // Unscoped SuperAdmin client still sees store1 payment
    await expect(
      prisma.subscriptionPayment.findMany({ where: { id: store1Payment.id } }),
    ).resolves.toHaveLength(1);

    // Cross-tenant create via scalar subscriptionId blocked
    await expect(
      db2.subscriptionPayment.create({
        data: {
          subscriptionId: store1Sub.id,
          provider: 'MANUAL_TRANSFER',
          amount: 49,
          externalReference: `ATK-SP-SCALAR-${suffix}`,
        },
      }),
    ).rejects.toThrow(CrossTenantAccessError);

    // Cross-tenant create via subscription.connect blocked
    await expect(
      db2.subscriptionPayment.create({
        data: {
          subscription: { connect: { id: store1Sub.id } },
          provider: 'MANUAL_TRANSFER',
          amount: 49,
          externalReference: `ATK-SP-CONNECT-${suffix}`,
        },
      }),
    ).rejects.toThrow(CrossTenantAccessError);

    // Cross-tenant update & delete blocked
    await expect(
      db2.subscriptionPayment.update({
        where: { id: store1Payment.id },
        data: { reviewStatus: 'REJECTED', externalReference: 'HACKED' },
      }),
    ).rejects.toThrow();

    await expect(
      db2.subscriptionPayment.delete({ where: { id: store1Payment.id } }),
    ).rejects.toThrow();

    const store1PaymentAfter = await prisma.subscriptionPayment.findUniqueOrThrow({
      where: { id: store1Payment.id },
    });
    expect(store1PaymentAfter.reviewStatus).toBe(store1Payment.reviewStatus);
    expect(store1PaymentAfter.externalReference).toBe(store1Payment.externalReference);

    // Legitimate own-tenant CRUD on store2Sub (scalar + connect + findMany + findUnique + update + delete)
    const ownByScalar = await db2.subscriptionPayment.create({
      data: {
        subscriptionId: store2Sub.id,
        provider: 'MANUAL_TRANSFER',
        amount: 19,
        externalReference: `E2E-SP-SCALAR-${suffix}`,
      },
    });
    cleanupSubscriptionPaymentIds.push(ownByScalar.id);

    const ownByConnect = await db2.subscriptionPayment.create({
      data: {
        subscription: { connect: { id: store2Sub.id } },
        provider: 'STRIPE',
        amount: 19,
        externalReference: `E2E-SP-CONNECT-${suffix}`,
      },
    });
    cleanupSubscriptionPaymentIds.push(ownByConnect.id);

    const listed = await db2.subscriptionPayment.findMany();
    expect(listed.map((p) => p.id).sort()).toEqual([ownByScalar.id, ownByConnect.id].sort());

    await expect(
      db2.subscriptionPayment.findUnique({ where: { id: ownByScalar.id } }),
    ).resolves.toMatchObject({ id: ownByScalar.id });

    const updated = await db2.subscriptionPayment.update({
      where: { id: ownByScalar.id },
      data: { reviewStatus: 'APPROVED' },
    });
    expect(updated.reviewStatus).toBe('APPROVED');

    await db2.subscriptionPayment.delete({ where: { id: ownByConnect.id } });
    await expect(
      prisma.subscriptionPayment.findUnique({ where: { id: ownByConnect.id } }),
    ).resolves.toBeNull();
  });

  it('executes legitimate nested updateMany/deleteMany on Cart, Order, Subscription, and Product without PrismaClientValidationError', async () => {
    const store1 = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'moda-mayorista' } });
    const store2 = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'electro-hogar' } });
    const store2Sub = await prisma.subscription.findUniqueOrThrow({
      where: { tenantId: store2.id },
    });
    const store1VariantBefore = await prisma.productVariant.findFirstOrThrow({
      where: { tenantId: store1.id },
    });

    const db2 = prisma.forTenant(store2.id);
    const suffix = Date.now();

    // 1. Product -> variants.{updateMany, deleteMany} (direct tenant-scoped model)
    const store2Product = await db2.product.create({
      data: {
        tenantId: store2.id,
        name: `E2E Nested Product ${suffix}`,
        slug: `e2e-nested-product-${suffix}`,
        variants: {
          create: [
            {
              tenantId: store2.id,
              sku: `E2E-VAR-1-${suffix}`,
              title: 'Variant Keep',
              attributes: { color: 'Negro' },
              retailPrice: 25,
              stockOnHand: 10,
            },
            {
              tenantId: store2.id,
              sku: `E2E-VAR-2-${suffix}`,
              title: 'Variant Delete',
              attributes: { color: 'Blanco' },
              retailPrice: 30,
              stockOnHand: 5,
            },
          ],
        },
      },
      include: { variants: true },
    });
    cleanupProductIds.push(store2Product.id);

    const keepVariant = store2Product.variants.find((v) => v.sku === `E2E-VAR-1-${suffix}`)!;
    const deleteVariant = store2Product.variants.find((v) => v.sku === `E2E-VAR-2-${suffix}`)!;

    await db2.product.update({
      where: { id: store2Product.id },
      data: {
        variants: {
          updateMany: {
            where: { id: keepVariant.id },
            data: { stockOnHand: 42 },
          },
          deleteMany: { id: deleteVariant.id },
        },
      },
    });

    const variantsAfter = await prisma.productVariant.findMany({
      where: { productId: store2Product.id },
    });
    expect(variantsAfter).toHaveLength(1);
    expect(variantsAfter[0].id).toBe(keepVariant.id);
    expect(variantsAfter[0].stockOnHand).toBe(42);

    // 2. Cart -> items.{updateMany, deleteMany} (child model without scalar tenantId)
    const store2Cart = await db2.cart.create({
      data: {
        tenantId: store2.id,
        guestToken: `e2e-nested-cart-${suffix}`,
        items: {
          create: [{ variantId: keepVariant.id, quantity: 1 }],
        },
      },
    });
    cleanupCartIds.push(store2Cart.id);

    await db2.cart.update({
      where: { id: store2Cart.id },
      data: {
        items: {
          updateMany: {
            where: { variantId: keepVariant.id },
            data: { quantity: 4 },
          },
        },
      },
    });
    const cartItemsUpdated = await prisma.cartItem.findMany({ where: { cartId: store2Cart.id } });
    expect(cartItemsUpdated).toHaveLength(1);
    expect(cartItemsUpdated[0].quantity).toBe(4);

    await db2.cart.update({
      where: { id: store2Cart.id },
      data: { items: { deleteMany: {} } },
    });
    await expect(prisma.cartItem.count({ where: { cartId: store2Cart.id } })).resolves.toBe(0);

    // 3. Order -> items.{updateMany, deleteMany} & statusHistory.{updateMany, deleteMany}
    const store2Order = await db2.order.create({
      data: {
        tenantId: store2.id,
        orderNumber: `E2E-ORD-NESTED-${suffix}`,
        checkoutChannel: 'MANUAL_PAYMENT',
        subtotal: 25,
        grandTotal: 25,
        items: {
          create: [
            {
              variantId: keepVariant.id,
              productNameSnapshot: store2Product.name,
              variantTitleSnapshot: keepVariant.title,
              skuSnapshot: keepVariant.sku,
              quantity: 1,
              unitPriceApplied: 25,
              lineTotal: 25,
            },
          ],
        },
        statusHistory: {
          create: [{ toStatus: 'PENDING_PAYMENT', note: 'Initial', changedByActor: 'SYSTEM' }],
        },
      },
    });
    cleanupOrderIds.push(store2Order.id);

    await db2.order.update({
      where: { id: store2Order.id },
      data: {
        items: {
          updateMany: {
            where: { variantId: keepVariant.id },
            data: { quantity: 2, lineTotal: 50 },
          },
        },
        statusHistory: {
          updateMany: {
            where: { toStatus: 'PENDING_PAYMENT' },
            data: { note: 'Updated note' },
          },
        },
      },
    });
    const orderItemsUpdated = await prisma.orderItem.findMany({
      where: { orderId: store2Order.id },
    });
    expect(orderItemsUpdated[0].quantity).toBe(2);
    const historyUpdated = await prisma.orderStatusHistory.findMany({
      where: { orderId: store2Order.id },
    });
    expect(historyUpdated[0].note).toBe('Updated note');

    await db2.order.update({
      where: { id: store2Order.id },
      data: {
        items: { deleteMany: {} },
        statusHistory: { deleteMany: {} },
      },
    });
    await expect(prisma.orderItem.count({ where: { orderId: store2Order.id } })).resolves.toBe(0);
    await expect(
      prisma.orderStatusHistory.count({ where: { orderId: store2Order.id } }),
    ).resolves.toBe(0);

    // 4. Subscription -> payments.{updateMany, deleteMany}
    const store2Payment = await db2.subscriptionPayment.create({
      data: {
        subscriptionId: store2Sub.id,
        provider: 'MANUAL_TRANSFER',
        amount: 19,
        externalReference: `E2E-SUB-NESTED-${suffix}`,
      },
    });
    cleanupSubscriptionPaymentIds.push(store2Payment.id);

    await db2.subscription.update({
      where: { id: store2Sub.id },
      data: {
        payments: {
          updateMany: {
            where: { id: store2Payment.id },
            data: { reviewStatus: 'APPROVED' },
          },
        },
      },
    });
    await expect(
      prisma.subscriptionPayment.findUniqueOrThrow({ where: { id: store2Payment.id } }),
    ).resolves.toMatchObject({ reviewStatus: 'APPROVED' });

    await db2.subscription.update({
      where: { id: store2Sub.id },
      data: {
        payments: {
          deleteMany: { id: store2Payment.id },
        },
      },
    });
    await expect(
      prisma.subscriptionPayment.findUnique({ where: { id: store2Payment.id } }),
    ).resolves.toBeNull();

    // Store 1 variant remains untouched
    const store1VariantAfter = await prisma.productVariant.findUniqueOrThrow({
      where: { id: store1VariantBefore.id },
    });
    expect(store1VariantAfter.stockOnHand).toBe(store1VariantBefore.stockOnHand);
  });

  it('processes BullMQ notifications and delivers HTML/text emails to Mailpit', async () => {
    await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: 'DELETE' });

    const suffix = Date.now();
    const toOtp = `otp-${suffix}@vendexa.local`;
    const toReset = `reset-${suffix}@vendexa.local`;
    const toWelcome = `welcome-${suffix}@vendexa.local`;
    const toPayment = `payment-${suffix}@vendexa.local`;

    await notificationsService.sendOtpVerification({
      to: toOtp,
      fullName: 'Ana Prueba',
      otpCode: '482910',
      expiresInMinutes: 10,
      storeName: 'Urban Threads Studio',
    });

    await notificationsService.sendPasswordResetOtp({
      to: toReset,
      fullName: 'Ana Prueba',
      otpCode: '917352',
      expiresInMinutes: 15,
    });

    await notificationsService.sendWelcome({
      to: toWelcome,
      fullName: 'Ana Prueba',
      storeName: 'Urban Threads Studio',
      loginUrl: 'http://moda-mayorista.localhost:3000/login',
    });

    await notificationsService.sendSubscriptionPaymentApproved({
      to: toPayment,
      ownerName: 'Carlos Mendoza',
      storeName: 'Urban Threads Studio',
      planName: 'Crecimiento Pro',
      amount: '49.00',
      currency: 'USD',
      externalReference: 'TRF-E2E-01',
    });

    const list = await waitForMailpitMessages(4);
    expect(list.messages.length).toBeGreaterThanOrEqual(4);

    const details = await Promise.all(
      list.messages.map(async (msg) => {
        const res = await fetch(`${MAILPIT_URL}/api/v1/message/${msg.ID}`);
        return (await res.json()) as MailpitDetailResponse;
      }),
    );

    const findByRecipient = (email: string) =>
      details.find((m) => m.To.some((recipient) => recipient.Address === email));

    const otpMsg = findByRecipient(toOtp);
    expect(otpMsg?.From.Address).toBe('no-reply@vendexa.local');
    expect(otpMsg?.Text).toContain('482910');
    expect(otpMsg?.HTML).toContain('Urban Threads Studio');

    const resetMsg = findByRecipient(toReset);
    expect(resetMsg?.Text).toContain('917352');

    const welcomeMsg = findByRecipient(toWelcome);
    expect(welcomeMsg?.HTML).toContain('http://moda-mayorista.localhost:3000/login');

    const paymentMsg = findByRecipient(toPayment);
    expect(paymentMsg?.HTML).toContain('49.00');
    expect(paymentMsg?.HTML).toContain('TRF-E2E-01');
  });
});
