import { Test, TestingModule } from '@nestjs/testing';
import { StorefrontService } from './storefront.service';
import { PrismaService } from '../../database/prisma.service';

describe('StorefrontService', () => {
  let service: StorefrontService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorefrontService,
        {
          provide: PrismaService,
          useValue: {
            forTenant: jest.fn().mockReturnValue({
              tenant: { findUnique: jest.fn() },
              coupon: { findUnique: jest.fn() },
              product: { findMany: jest.fn(), count: jest.fn(), findFirst: jest.fn() },
            }),
          },
        },
      ],
    }).compile();

    service = module.get<StorefrontService>(StorefrontService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
