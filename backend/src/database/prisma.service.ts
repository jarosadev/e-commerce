import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const TENANT_SCOPED_MODELS = new Set([
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
]);

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Conectado a PostgreSQL exitosamente.');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Retorna un cliente Prisma extendido que fuerza el aislamiento por tenantId
   * en todas las operaciones sobre modelos Multi-Tenant para evitar fugas de datos.
   */
  forTenant(tenantId: string) {
    if (!tenantId) {
      throw new Error('Se intentó instanciar PrismaService.forTenant sin un tenantId válido.');
    }

    return this.$extends({
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            if (!model || !TENANT_SCOPED_MODELS.has(model)) {
              return query(args);
            }

            const mutableArgs = (args ?? {}) as Record<string, any>;

            if (
              operation === 'findMany' ||
              operation === 'findFirst' ||
              operation === 'count' ||
              operation === 'updateMany' ||
              operation === 'deleteMany'
            ) {
              mutableArgs.where = { ...(mutableArgs.where ?? {}), tenantId };
            } else if (operation === 'create') {
              mutableArgs.data = { ...(mutableArgs.data ?? {}), tenantId };
            } else if (operation === 'createMany' && Array.isArray(mutableArgs.data)) {
              mutableArgs.data = mutableArgs.data.map((row: Record<string, unknown>) => ({
                ...row,
                tenantId,
              }));
            }

            return query(mutableArgs);
          },
        },
      },
    });
  }
}
