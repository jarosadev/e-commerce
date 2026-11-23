import { CrossTenantAccessError, PrismaService } from './prisma.service';

interface HookCapture {
  query: {
    $allModels: {
      $allOperations: (params: {
        model?: string;
        operation: string;
        args: unknown;
        query: (nextArgs: unknown) => Promise<unknown>;
      }) => Promise<unknown>;
    };
  };
}

describe('PrismaService.forTenant', () => {
  const TENANT_A = 'tenant-a-uuid';
  const TENANT_B = 'tenant-b-uuid';

  let prisma: PrismaService;
  let runHook: HookCapture['query']['$allModels']['$allOperations'];
  let mockQuery: jest.Mock;

  beforeEach(() => {
    prisma = new PrismaService();
    mockQuery = jest.fn(async (args) => args);

    jest.spyOn(prisma, '$extends').mockImplementation(((ext: HookCapture) => ext) as never);
    const extended = prisma.forTenant(TENANT_A) as unknown as HookCapture;
    runHook = extended.query.$allModels.$allOperations;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('rejects empty or whitespace tenantId', () => {
    expect(() => prisma.forTenant('')).toThrow();
    expect(() => prisma.forTenant('   ')).toThrow();
  });

  it('leaves non-tenant global models (Plan, PlatformUser, PlatformRefreshToken, TenantOwnerProfile, Tenant) untouched', async () => {
    for (const model of [
      'Plan',
      'PlatformUser',
      'PlatformRefreshToken',
      'TenantOwnerProfile',
      'Tenant',
    ]) {
      const originalArgs = { where: { id: 'global-1' } };
      await runHook({ model, operation: 'findMany', args: originalArgs, query: mockQuery });
      expect(mockQuery).toHaveBeenLastCalledWith(originalArgs);
    }
  });

  it('enforces tenantId across all 21 direct tenant-scoped models', async () => {
    const models = [
      'TenantMember',
      'Subscription',
      'CustomDomain',
      'StoreTheme',
      'Category',
      'Product',
      'ProductImage',
      'ProductVariant',
      'WholesaleTier',
      'CsvImportJob',
      'StoreCustomer',
      'CustomerRefreshToken',
      'CustomerAddress',
      'Cart',
      'WishlistItem',
      'ProductReview',
      'Coupon',
      'ShippingZone',
      'StorePaymentMethod',
      'Order',
      'OrderPaymentReceipt',
    ];

    for (const model of models) {
      await runHook({
        model,
        operation: 'findMany',
        args: { where: { isActive: true } },
        query: mockQuery,
      });
      expect(mockQuery).toHaveBeenLastCalledWith({
        where: { AND: [{ isActive: true }, { tenantId: TENANT_A }] },
      });
    }
  });

  it('scopes all 9 filter operations and rejects conflicting tenantId in where/data', async () => {
    const filterOps = [
      'findMany',
      'findFirst',
      'findFirstOrThrow',
      'count',
      'aggregate',
      'groupBy',
      'updateMany',
      'deleteMany',
      'updateManyAndReturn',
    ];

    for (const operation of filterOps) {
      const baseArgs =
        operation === 'updateMany' || operation === 'updateManyAndReturn'
          ? { where: { isActive: true }, data: { isActive: false } }
          : { where: { isActive: true } };
      await runHook({ model: 'Product', operation, args: baseArgs, query: mockQuery });
      expect(mockQuery).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: { AND: [{ isActive: true }, { tenantId: TENANT_A }] },
        }),
      );
    }

    await expect(
      runHook({
        model: 'Product',
        operation: 'findFirstOrThrow',
        args: { where: { tenantId: TENANT_B } },
        query: mockQuery,
      }),
    ).rejects.toThrow(CrossTenantAccessError);

    await expect(
      runHook({
        model: 'Product',
        operation: 'updateManyAndReturn',
        args: { where: {}, data: { tenantId: TENANT_B } },
        query: mockQuery,
      }),
    ).rejects.toThrow(CrossTenantAccessError);
  });

  it('scopes all 5 unique operations while preserving top-level unique keys', async () => {
    for (const operation of ['findUnique', 'findUniqueOrThrow', 'delete']) {
      await runHook({
        model: 'StoreTheme',
        operation,
        args: { where: { id: 'theme-1' } },
        query: mockQuery,
      });
      expect(mockQuery).toHaveBeenLastCalledWith({
        where: { id: 'theme-1', AND: [{ tenantId: TENANT_A }] },
      });
    }

    await runHook({
      model: 'Product',
      operation: 'update',
      args: { where: { id: 'prod-1' }, data: { name: 'Updated' } },
      query: mockQuery,
    });
    expect(mockQuery).toHaveBeenLastCalledWith({
      where: { id: 'prod-1', AND: [{ tenantId: TENANT_A }] },
      data: { name: 'Updated' },
    });

    await runHook({
      model: 'Category',
      operation: 'upsert',
      args: {
        where: { tenantId_slug: { tenantId: TENANT_A, slug: 'hoodies' } },
        create: { name: 'Hoodies', slug: 'hoodies' },
        update: { name: 'Hoodies 2' },
      },
      query: mockQuery,
    });
    expect(mockQuery).toHaveBeenLastCalledWith({
      where: {
        tenantId_slug: { tenantId: TENANT_A, slug: 'hoodies' },
        AND: [{ tenantId: TENANT_A }],
      },
      create: { name: 'Hoodies', slug: 'hoodies', tenantId: TENANT_A },
      update: { name: 'Hoodies 2' },
    });

    await expect(
      runHook({
        model: 'Product',
        operation: 'findUnique',
        args: { where: { tenantId_slug: { tenantId: TENANT_B, slug: 'shirt' } } },
        query: mockQuery,
      }),
    ).rejects.toThrow(CrossTenantAccessError);

    await expect(
      runHook({
        model: 'Product',
        operation: 'update',
        args: { where: { id: 'prod-1' }, data: { tenantId: TENANT_B } },
        query: mockQuery,
      }),
    ).rejects.toThrow(CrossTenantAccessError);
  });

  it('handles create, createMany (array and object), createManyAndReturn, and tenant.connect', async () => {
    await runHook({
      model: 'Product',
      operation: 'create',
      args: { data: { name: 'Jacket', slug: 'jacket' } },
      query: mockQuery,
    });
    expect(mockQuery).toHaveBeenLastCalledWith({
      data: { name: 'Jacket', slug: 'jacket', tenantId: TENANT_A },
    });

    await runHook({
      model: 'Product',
      operation: 'create',
      args: { data: { name: 'Jacket', slug: 'jacket', tenant: { connect: { id: TENANT_A } } } },
      query: mockQuery,
    });
    expect(mockQuery).toHaveBeenLastCalledWith({
      data: { name: 'Jacket', slug: 'jacket', tenant: { connect: { id: TENANT_A } } },
    });

    await expect(
      runHook({
        model: 'Product',
        operation: 'create',
        args: { data: { name: 'Bad', tenant: { connect: { id: TENANT_B } } } },
        query: mockQuery,
      }),
    ).rejects.toThrow(CrossTenantAccessError);

    await runHook({
      model: 'Category',
      operation: 'createMany',
      args: {
        data: [
          { name: 'A', slug: 'a' },
          { name: 'B', slug: 'b' },
        ],
      },
      query: mockQuery,
    });
    expect(mockQuery).toHaveBeenLastCalledWith({
      data: [
        { name: 'A', slug: 'a', tenantId: TENANT_A },
        { name: 'B', slug: 'b', tenantId: TENANT_A },
      ],
    });

    await runHook({
      model: 'Category',
      operation: 'createManyAndReturn',
      args: { data: { name: 'Single', slug: 'single' } },
      query: mockQuery,
    });
    expect(mockQuery).toHaveBeenLastCalledWith({
      data: { name: 'Single', slug: 'single', tenantId: TENANT_A },
    });
  });

  it('enforces parent relation ownership on child models (CartItem, OrderItem, OrderStatusHistory)', async () => {
    const cartFindFirst = jest
      .spyOn(prisma.cart, 'findFirst')
      .mockResolvedValue({ id: 'cart-1' } as never);
    const variantFindFirst = jest
      .spyOn(prisma.productVariant, 'findFirst')
      .mockResolvedValue({ id: 'var-1' } as never);

    await runHook({
      model: 'CartItem',
      operation: 'findMany',
      args: { where: { cartId: 'cart-1' } },
      query: mockQuery,
    });
    expect(mockQuery).toHaveBeenLastCalledWith({
      where: { AND: [{ cartId: 'cart-1' }, { cart: { tenantId: TENANT_A } }] },
    });

    await runHook({
      model: 'CartItem',
      operation: 'create',
      args: { data: { cartId: 'cart-1', variantId: 'var-1', quantity: 2 } },
      query: mockQuery,
    });
    expect(cartFindFirst).toHaveBeenCalledWith({
      where: { id: 'cart-1', tenantId: TENANT_A },
      select: { id: true },
    });
    expect(variantFindFirst).toHaveBeenCalledWith({
      where: { id: 'var-1', tenantId: TENANT_A },
      select: { id: true },
    });

    cartFindFirst.mockResolvedValueOnce(null);
    await expect(
      runHook({
        model: 'CartItem',
        operation: 'create',
        args: { data: { cartId: 'foreign-cart', variantId: 'var-1', quantity: 1 } },
        query: mockQuery,
      }),
    ).rejects.toThrow(CrossTenantAccessError);

    const orderFindFirst = jest.spyOn(prisma.order, 'findFirst').mockResolvedValueOnce(null);
    await expect(
      runHook({
        model: 'OrderStatusHistory',
        operation: 'create',
        args: {
          data: { orderId: 'foreign-order', toStatus: 'PREPARING', changedByActor: 'SYSTEM' },
        },
        query: mockQuery,
      }),
    ).rejects.toThrow(CrossTenantAccessError);
    expect(orderFindFirst).toHaveBeenCalledWith({
      where: { id: 'foreign-order', tenantId: TENANT_A },
      select: { id: true },
    });
  });

  it('enforces parent subscription ownership on SubscriptionPayment across all operations', async () => {
    const subFindFirst = jest.spyOn(prisma.subscription, 'findFirst');

    await runHook({
      model: 'SubscriptionPayment',
      operation: 'findMany',
      args: { where: { reviewStatus: 'PENDING' } },
      query: mockQuery,
    });
    expect(mockQuery).toHaveBeenLastCalledWith({
      where: { AND: [{ reviewStatus: 'PENDING' }, { subscription: { tenantId: TENANT_A } }] },
    });

    await runHook({
      model: 'SubscriptionPayment',
      operation: 'findUnique',
      args: { where: { id: 'sp-1' } },
      query: mockQuery,
    });
    expect(mockQuery).toHaveBeenLastCalledWith({
      where: { id: 'sp-1', AND: [{ subscription: { tenantId: TENANT_A } }] },
    });

    // Create with owned scalar subscriptionId
    subFindFirst.mockResolvedValueOnce({ id: 'sub-a' } as never);
    await runHook({
      model: 'SubscriptionPayment',
      operation: 'create',
      args: { data: { subscriptionId: 'sub-a', provider: 'MANUAL_TRANSFER', amount: 49 } },
      query: mockQuery,
    });
    expect(subFindFirst).toHaveBeenCalledWith({
      where: { id: 'sub-a', tenantId: TENANT_A },
      select: { id: true },
    });

    // Create with foreign scalar subscriptionId rejects
    subFindFirst.mockResolvedValueOnce(null);
    await expect(
      runHook({
        model: 'SubscriptionPayment',
        operation: 'create',
        args: { data: { subscriptionId: 'foreign-sub', provider: 'MANUAL_TRANSFER', amount: 49 } },
        query: mockQuery,
      }),
    ).rejects.toThrow(CrossTenantAccessError);

    // Create with owned subscription.connect
    subFindFirst.mockResolvedValueOnce({ id: 'sub-a' } as never);
    await runHook({
      model: 'SubscriptionPayment',
      operation: 'create',
      args: {
        data: {
          subscription: { connect: { id: 'sub-a' } },
          provider: 'STRIPE',
          amount: 49,
        },
      },
      query: mockQuery,
    });

    // Create with foreign subscription.connect rejects
    subFindFirst.mockResolvedValueOnce(null);
    await expect(
      runHook({
        model: 'SubscriptionPayment',
        operation: 'create',
        args: {
          data: {
            subscription: { connect: { id: 'foreign-sub' } },
            provider: 'MANUAL_TRANSFER',
            amount: 49,
          },
        },
        query: mockQuery,
      }),
    ).rejects.toThrow(CrossTenantAccessError);

    // Create missing both subscriptionId and subscription.connect rejects
    await expect(
      runHook({
        model: 'SubscriptionPayment',
        operation: 'create',
        args: { data: { provider: 'MANUAL_TRANSFER', amount: 49 } },
        query: mockQuery,
      }),
    ).rejects.toThrow(CrossTenantAccessError);

    // Update scopes where and blocks foreign subscriptionId / nullification / disconnect
    await runHook({
      model: 'SubscriptionPayment',
      operation: 'update',
      args: { where: { id: 'sp-1' }, data: { reviewStatus: 'APPROVED' } },
      query: mockQuery,
    });
    expect(mockQuery).toHaveBeenLastCalledWith({
      where: { id: 'sp-1', AND: [{ subscription: { tenantId: TENANT_A } }] },
      data: { reviewStatus: 'APPROVED' },
    });

    subFindFirst.mockResolvedValueOnce(null);
    await expect(
      runHook({
        model: 'SubscriptionPayment',
        operation: 'update',
        args: { where: { id: 'sp-1' }, data: { subscriptionId: 'foreign-sub' } },
        query: mockQuery,
      }),
    ).rejects.toThrow(CrossTenantAccessError);

    await expect(
      runHook({
        model: 'SubscriptionPayment',
        operation: 'update',
        args: { where: { id: 'sp-1' }, data: { subscriptionId: null } },
        query: mockQuery,
      }),
    ).rejects.toThrow(CrossTenantAccessError);

    await expect(
      runHook({
        model: 'SubscriptionPayment',
        operation: 'update',
        args: { where: { id: 'sp-1' }, data: { subscription: { disconnect: true } } },
        query: mockQuery,
      }),
    ).rejects.toThrow(CrossTenantAccessError);

    // Delete scopes where
    await runHook({
      model: 'SubscriptionPayment',
      operation: 'delete',
      args: { where: { id: 'sp-1' } },
      query: mockQuery,
    });
    expect(mockQuery).toHaveBeenLastCalledWith({
      where: { id: 'sp-1', AND: [{ subscription: { tenantId: TENANT_A } }] },
    });

    subFindFirst.mockRestore();
  });

  it('blocks nested relation create/createMany/connect/connectOrCreate/set/update/delete across tenants (vectors 5a-5c + Order equivalents)', async () => {
    // 5a: Product.create -> variants.create with foreign tenantId rejects; missing tenantId is injected
    await expect(
      runHook({
        model: 'Product',
        operation: 'create',
        args: {
          data: {
            name: 'Hoodie',
            slug: 'hoodie',
            variants: { create: [{ tenantId: TENANT_B, sku: 'BAD-1', title: 'M' }] },
          },
        },
        query: mockQuery,
      }),
    ).rejects.toThrow(CrossTenantAccessError);

    await runHook({
      model: 'Product',
      operation: 'create',
      args: {
        data: {
          name: 'Hoodie',
          slug: 'hoodie',
          variants: { create: [{ sku: 'GOOD-1', title: 'M' }] },
        },
      },
      query: mockQuery,
    });
    expect(mockQuery).toHaveBeenLastCalledWith({
      data: {
        name: 'Hoodie',
        slug: 'hoodie',
        tenantId: TENANT_A,
        variants: { create: [{ sku: 'GOOD-1', title: 'M', tenantId: TENANT_A }] },
      },
    });

    // 5b: Cart.create -> items.create with foreign variantId rejects; Order.create -> items.create rejects too
    const variantFindFirst = jest.spyOn(prisma.productVariant, 'findFirst').mockResolvedValue(null);
    await expect(
      runHook({
        model: 'Cart',
        operation: 'create',
        args: {
          data: {
            guestToken: 'guest-1',
            items: { create: [{ variantId: 'foreign-var', quantity: 2 }] },
          },
        },
        query: mockQuery,
      }),
    ).rejects.toThrow(CrossTenantAccessError);

    await expect(
      runHook({
        model: 'Order',
        operation: 'create',
        args: {
          data: {
            orderNumber: 'ORD-1',
            items: { create: [{ variantId: 'foreign-var', quantity: 1 }] },
          },
        },
        query: mockQuery,
      }),
    ).rejects.toThrow(CrossTenantAccessError);
    variantFindFirst.mockRestore();

    // 5c: Category.create -> products.connect with foreign product rejects
    const productFindFirst = jest.spyOn(prisma.product, 'findFirst').mockResolvedValue(null);
    await expect(
      runHook({
        model: 'Category',
        operation: 'create',
        args: {
          data: {
            name: 'New Cat',
            slug: 'new-cat',
            products: { connect: [{ id: 'foreign-prod' }] },
          },
        },
        query: mockQuery,
      }),
    ).rejects.toThrow(CrossTenantAccessError);

    // connectOrCreate rejects when existing target belongs to another tenant
    productFindFirst.mockResolvedValueOnce({ id: 'foreign-prod' } as never); // exists globally
    productFindFirst.mockResolvedValueOnce(null); // not owned by TENANT_A
    await expect(
      runHook({
        model: 'Category',
        operation: 'update',
        args: {
          where: { id: 'cat-a' },
          data: {
            products: {
              connectOrCreate: {
                where: { id: 'foreign-prod' },
                create: { name: 'P', slug: 'p' },
              },
            },
          },
        },
        query: mockQuery,
      }),
    ).rejects.toThrow(CrossTenantAccessError);

    // set / disconnect / delete on foreign targets reject
    productFindFirst.mockResolvedValue(null);
    await expect(
      runHook({
        model: 'Category',
        operation: 'update',
        args: {
          where: { id: 'cat-a' },
          data: { products: { set: [{ id: 'foreign-prod' }] } },
        },
        query: mockQuery,
      }),
    ).rejects.toThrow(CrossTenantAccessError);

    await expect(
      runHook({
        model: 'Category',
        operation: 'update',
        args: {
          where: { id: 'cat-a' },
          data: { products: { delete: [{ id: 'foreign-prod' }] } },
        },
        query: mockQuery,
      }),
    ).rejects.toThrow(CrossTenantAccessError);
    productFindFirst.mockRestore();
  });

  it('keeps scalar-only where in nested updateMany/deleteMany for child models while scoping direct tenant models', async () => {
    // 1. Child models (CartItem, OrderItem, OrderStatusHistory, SubscriptionPayment) MUST NOT inject relation filters
    await runHook({
      model: 'Cart',
      operation: 'update',
      args: {
        where: { id: 'cart-a' },
        data: {
          items: {
            updateMany: { where: { variantId: 'var-a' }, data: { quantity: 3 } },
            deleteMany: {},
          },
        },
      },
      query: mockQuery,
    });
    expect(mockQuery).toHaveBeenLastCalledWith({
      where: { id: 'cart-a', AND: [{ tenantId: TENANT_A }] },
      data: {
        items: {
          updateMany: { where: { variantId: 'var-a' }, data: { quantity: 3 } },
          deleteMany: {},
        },
      },
    });

    await runHook({
      model: 'Order',
      operation: 'update',
      args: {
        where: { id: 'ord-a' },
        data: {
          items: {
            updateMany: { where: { variantId: 'var-a' }, data: { quantity: 2 } },
            deleteMany: [{ variantId: 'var-b' }],
          },
          statusHistory: {
            updateMany: { where: {}, data: { note: 'Verified' } },
            deleteMany: {},
          },
        },
      },
      query: mockQuery,
    });
    expect(mockQuery).toHaveBeenLastCalledWith({
      where: { id: 'ord-a', AND: [{ tenantId: TENANT_A }] },
      data: {
        items: {
          updateMany: { where: { variantId: 'var-a' }, data: { quantity: 2 } },
          deleteMany: [{ variantId: 'var-b' }],
        },
        statusHistory: {
          updateMany: { where: {}, data: { note: 'Verified' } },
          deleteMany: {},
        },
      },
    });

    await runHook({
      model: 'Subscription',
      operation: 'update',
      args: {
        where: { id: 'sub-a' },
        data: {
          payments: {
            updateMany: { where: { reviewStatus: 'PENDING' }, data: { reviewStatus: 'APPROVED' } },
            deleteMany: { reviewStatus: 'REJECTED' },
          },
        },
      },
      query: mockQuery,
    });
    expect(mockQuery).toHaveBeenLastCalledWith({
      where: { id: 'sub-a', AND: [{ tenantId: TENANT_A }] },
      data: {
        payments: {
          updateMany: { where: { reviewStatus: 'PENDING' }, data: { reviewStatus: 'APPROVED' } },
          deleteMany: { reviewStatus: 'REJECTED' },
        },
      },
    });

    // Child nested updateMany.data still blocks foreign variantId / parent FK mutation
    const variantFindFirst = jest
      .spyOn(prisma.productVariant, 'findFirst')
      .mockResolvedValueOnce(null);
    await expect(
      runHook({
        model: 'Cart',
        operation: 'update',
        args: {
          where: { id: 'cart-a' },
          data: { items: { updateMany: { where: {}, data: { variantId: 'foreign-var' } } } },
        },
        query: mockQuery,
      }),
    ).rejects.toThrow(CrossTenantAccessError);
    variantFindFirst.mockRestore();

    // 2. Direct tenant-scoped child relation (Product.variants -> ProductVariant) MUST still inject scalar tenantId
    await runHook({
      model: 'Product',
      operation: 'update',
      args: {
        where: { id: 'prod-a' },
        data: {
          variants: {
            updateMany: { where: { isActive: true }, data: { stockOnHand: 15 } },
            deleteMany: {},
          },
        },
      },
      query: mockQuery,
    });
    expect(mockQuery).toHaveBeenLastCalledWith({
      where: { id: 'prod-a', AND: [{ tenantId: TENANT_A }] },
      data: {
        variants: {
          updateMany: {
            where: { isActive: true, AND: [{ tenantId: TENANT_A }] },
            data: { stockOnHand: 15 },
          },
          deleteMany: { tenantId: TENANT_A },
        },
      },
    });

    // Direct tenant-scoped nested updateMany/deleteMany rejects conflicting tenantId
    await expect(
      runHook({
        model: 'Product',
        operation: 'update',
        args: {
          where: { id: 'prod-a' },
          data: { variants: { deleteMany: { tenantId: TENANT_B } } },
        },
        query: mockQuery,
      }),
    ).rejects.toThrow(CrossTenantAccessError);

    await expect(
      runHook({
        model: 'Product',
        operation: 'update',
        args: {
          where: { id: 'prod-a' },
          data: {
            variants: { updateMany: { where: {}, data: { tenantId: TENANT_B } } },
          },
        },
        query: mockQuery,
      }),
    ).rejects.toThrow(CrossTenantAccessError);
  });

  it('validates direct cross-tenant scalar foreign keys on create/update/upsert (vectors 5d-5f + Order equivalents)', async () => {
    const productFindFirst = jest.spyOn(prisma.product, 'findFirst').mockResolvedValue(null);
    const categoryFindFirst = jest.spyOn(prisma.category, 'findFirst').mockResolvedValue(null);
    const customerFindFirst = jest.spyOn(prisma.storeCustomer, 'findFirst').mockResolvedValue(null);
    const orderFindFirst = jest.spyOn(prisma.order, 'findFirst').mockResolvedValue(null);

    // 5d: WholesaleTier.create with foreign productId
    await expect(
      runHook({
        model: 'WholesaleTier',
        operation: 'create',
        args: { data: { productId: 'foreign-prod', minQuantity: 1, unitPrice: 1 } },
        query: mockQuery,
      }),
    ).rejects.toThrow(CrossTenantAccessError);

    // 5e: Product.create with foreign categoryId, while null categoryId is allowed
    await expect(
      runHook({
        model: 'Product',
        operation: 'create',
        args: { data: { name: 'P', slug: 'p', categoryId: 'foreign-cat' } },
        query: mockQuery,
      }),
    ).rejects.toThrow(CrossTenantAccessError);

    await runHook({
      model: 'Product',
      operation: 'create',
      args: { data: { name: 'P', slug: 'p', categoryId: null } },
      query: mockQuery,
    });

    // 5f: Cart.create with foreign customerId
    await expect(
      runHook({
        model: 'Cart',
        operation: 'create',
        args: { data: { customerId: 'foreign-cust' } },
        query: mockQuery,
      }),
    ).rejects.toThrow(CrossTenantAccessError);

    // Category.update with foreign parentId ({ set })
    await expect(
      runHook({
        model: 'Category',
        operation: 'update',
        args: { where: { id: 'cat-a' }, data: { parentId: { set: 'foreign-cat' } } },
        query: mockQuery,
      }),
    ).rejects.toThrow(CrossTenantAccessError);

    // OrderPaymentReceipt.create with foreign orderId
    await expect(
      runHook({
        model: 'OrderPaymentReceipt',
        operation: 'create',
        args: { data: { orderId: 'foreign-order', fileKey: 'receipt.pdf' } },
        query: mockQuery,
      }),
    ).rejects.toThrow(CrossTenantAccessError);

    // Order.create with foreign customerId
    await expect(
      runHook({
        model: 'Order',
        operation: 'create',
        args: { data: { orderNumber: 'ORD-2', customerId: 'foreign-cust' } },
        query: mockQuery,
      }),
    ).rejects.toThrow(CrossTenantAccessError);

    productFindFirst.mockRestore();
    categoryFindFirst.mockRestore();
    customerFindFirst.mockRestore();
    orderFindFirst.mockRestore();
  });
});
