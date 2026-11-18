import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { RedisService } from '../src/redis/redis.module';
import cookieParser from 'cookie-parser';

describe('M4 Storefront (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let tenantId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    
    // Get a tenant for testing
    const tenant = await prisma.tenant.findFirstOrThrow({ where: { slug: 'moda-mayorista' } });
    tenantId = tenant.id;
  });

  afterAll(async () => {
    await redis.delByPattern('tenant:host:*');
    await app.close();
  });

  it('GET /api/v1/storefront/products returns product list', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/storefront/products')
      .set('x-tenant-host', 'moda-mayorista.localhost:3000')
      .expect(200);

    expect(res.body).toHaveProperty('items');
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it('GET /api/v1/storefront/products/:slug returns a product', async () => {
    const product = await prisma.product.findFirst({
        where: { tenantId: tenantId },
    });
    
    if (product) {
        const res = await request(app.getHttpServer())
          .get(`/api/v1/storefront/products/${product.slug}`)
          .set('x-tenant-host', 'moda-mayorista.localhost:3000')
          .expect(200);

        expect(res.body).toHaveProperty('slug', product.slug);
    }
  });
});
