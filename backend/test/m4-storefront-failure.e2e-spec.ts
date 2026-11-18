import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { RedisService } from '../src/redis/redis.module';
import cookieParser from 'cookie-parser';

describe('M4 Storefront Failure Modes (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;

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
  });

  afterAll(async () => {
    await redis.delByPattern('tenant:host:*');
    await app.close();
  });

  it('GET /api/v1/storefront/products returns 404 for invalid tenant', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/storefront/products')
      .set('x-tenant-host', 'non-existent-tenant.localhost:3000')
      .expect(404); // Or 403, depending on implementation
  });

  it('GET /api/v1/storefront/products/:slug returns 404 for non-existent product', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/storefront/products/non-existent-slug')
      .set('x-tenant-host', 'moda-mayorista.localhost:3000')
      .expect(404);
  });
});
