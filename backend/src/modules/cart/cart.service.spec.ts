import { Test, TestingModule } from '@nestjs/testing';
import { CartService } from './cart.service';
import { PrismaService } from '../../database/prisma.service';

describe('CartService', () => {
  let service: CartService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CartService,
        {
          provide: PrismaService,
          useValue: {
            forTenant: jest.fn().mockReturnValue({
              productVariant: { findFirst: jest.fn() },
              cart: { findFirst: jest.fn(), create: jest.fn(), delete: jest.fn() },
              cartItem: {
                upsert: jest.fn(),
                delete: jest.fn(),
                update: jest.fn(),
                deleteMany: jest.fn(),
              },
            }),
          },
        },
      ],
    }).compile();

    service = module.get<CartService>(CartService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
