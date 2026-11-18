import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('PlatformAdmin (CRM) E2E', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    // Give time for any active background jobs to finish
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await app.close();
  });

  // Note: This test will fail if authentication is not mocked or handled correctly.
  // The controller requires SUPER_ADMIN role.
  it('/platform-admin/overview (GET)', () => {
    return request(app.getHttpServer()).get('/platform-admin/overview').expect(401); // Expecting 401 because no auth token is provided
  });
});
