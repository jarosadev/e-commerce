import {
  ForbiddenException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

export class CrossTenantAccessError extends ForbiddenException {
  constructor(message = 'Acceso cross-tenant no autorizado.') {
    super(message);
    this.name = 'CrossTenantAccessError';
  }
}

const TENANT_SCOPED_MODELS = new Set<string>([
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
]);

interface ChildRelationConfig {
  relationField: 'cart' | 'order' | 'subscription';
  foreignKeyField: 'cartId' | 'orderId' | 'subscriptionId';
  parentDelegate: 'cart' | 'order' | 'subscription';
  hasVariantField: boolean;
}

const CHILD_TENANT_RELATION_MAP: Record<string, ChildRelationConfig> = {
  CartItem: {
    relationField: 'cart',
    foreignKeyField: 'cartId',
    parentDelegate: 'cart',
    hasVariantField: true,
  },
  OrderItem: {
    relationField: 'order',
    foreignKeyField: 'orderId',
    parentDelegate: 'order',
    hasVariantField: true,
  },
  OrderStatusHistory: {
    relationField: 'order',
    foreignKeyField: 'orderId',
    parentDelegate: 'order',
    hasVariantField: false,
  },
  SubscriptionPayment: {
    relationField: 'subscription',
    foreignKeyField: 'subscriptionId',
    parentDelegate: 'subscription',
    hasVariantField: false,
  },
};

const COMPOUND_TENANT_UNIQUE_KEYS = [
  'tenantId_userId',
  'tenantId_slug',
  'tenantId_sku',
  'tenantId_email',
  'tenantId_code',
  'tenantId_orderNumber',
] as const;

const MODEL_TO_DELEGATE: Record<string, keyof PrismaClient> = {
  TenantMember: 'tenantMember',
  Subscription: 'subscription',
  SubscriptionPayment: 'subscriptionPayment',
  CustomDomain: 'customDomain',
  StoreTheme: 'storeTheme',
  Category: 'category',
  Product: 'product',
  ProductImage: 'productImage',
  ProductVariant: 'productVariant',
  WholesaleTier: 'wholesaleTier',
  CsvImportJob: 'csvImportJob',
  StoreCustomer: 'storeCustomer',
  CustomerRefreshToken: 'customerRefreshToken',
  CustomerAddress: 'customerAddress',
  Cart: 'cart',
  CartItem: 'cartItem',
  WishlistItem: 'wishlistItem',
  ProductReview: 'productReview',
  Coupon: 'coupon',
  ShippingZone: 'shippingZone',
  StorePaymentMethod: 'storePaymentMethod',
  Order: 'order',
  OrderItem: 'orderItem',
  OrderPaymentReceipt: 'orderPaymentReceipt',
  OrderStatusHistory: 'orderStatusHistory',
};

const SCALAR_FK_TARGET_MODEL: Record<string, string> = {
  subscriptionId: 'Subscription',
  categoryId: 'Category',
  productId: 'Product',
  variantId: 'ProductVariant',
  customerId: 'StoreCustomer',
  cartId: 'Cart',
  orderId: 'Order',
  couponId: 'Coupon',
  shippingZoneId: 'ShippingZone',
  paymentMethodId: 'StorePaymentMethod',
  addressId: 'CustomerAddress',
};

const MODEL_RELATIONS: Record<string, Record<string, string>> = {
  Subscription: {
    payments: 'SubscriptionPayment',
  },
  SubscriptionPayment: {
    subscription: 'Subscription',
  },
  Category: {
    parent: 'Category',
    children: 'Category',
    products: 'Product',
  },
  Product: {
    category: 'Category',
    images: 'ProductImage',
    variants: 'ProductVariant',
    wholesaleTiers: 'WholesaleTier',
    wishlistItems: 'WishlistItem',
    reviews: 'ProductReview',
  },
  ProductImage: {
    product: 'Product',
  },
  ProductVariant: {
    product: 'Product',
    cartItems: 'CartItem',
    orderItems: 'OrderItem',
  },
  WholesaleTier: {
    product: 'Product',
  },
  StoreCustomer: {
    refreshTokens: 'CustomerRefreshToken',
    addresses: 'CustomerAddress',
    carts: 'Cart',
    wishlistItems: 'WishlistItem',
    reviews: 'ProductReview',
    orders: 'Order',
  },
  CustomerRefreshToken: {
    customer: 'StoreCustomer',
  },
  CustomerAddress: {
    customer: 'StoreCustomer',
  },
  Cart: {
    customer: 'StoreCustomer',
    items: 'CartItem',
  },
  CartItem: {
    cart: 'Cart',
    variant: 'ProductVariant',
  },
  WishlistItem: {
    customer: 'StoreCustomer',
    product: 'Product',
  },
  ProductReview: {
    product: 'Product',
    customer: 'StoreCustomer',
  },
  Order: {
    customer: 'StoreCustomer',
    items: 'OrderItem',
    receipts: 'OrderPaymentReceipt',
    statusHistory: 'OrderStatusHistory',
  },
  OrderItem: {
    order: 'Order',
    variant: 'ProductVariant',
  },
  OrderPaymentReceipt: {
    order: 'Order',
  },
  OrderStatusHistory: {
    order: 'Order',
  },
};

const ALLOWED_NESTED_RELATION_ACTIONS = new Set<string>([
  'create',
  'createMany',
  'connect',
  'connectOrCreate',
  'set',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
  'disconnect',
]);

const FILTER_OPERATIONS = new Set<string>([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'count',
  'aggregate',
  'groupBy',
  'updateMany',
  'deleteMany',
  'updateManyAndReturn',
]);

const UNIQUE_OPERATIONS = new Set<string>([
  'findUnique',
  'findUniqueOrThrow',
  'update',
  'delete',
  'upsert',
]);

const CREATE_OPERATIONS = new Set<string>(['create', 'createMany', 'createManyAndReturn']);

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertNoConflictingTenantInWhere(where: unknown, tenantId: string): void {
  if (!isRecord(where)) return;

  const whereTenantId = where.tenantId;
  if (typeof whereTenantId === 'string' && whereTenantId !== tenantId) {
    throw new CrossTenantAccessError('Conflicto de tenantId en cláusula where.');
  }
  if (isRecord(whereTenantId)) {
    if (typeof whereTenantId.equals === 'string' && whereTenantId.equals !== tenantId) {
      throw new CrossTenantAccessError('Conflicto de tenantId.equals en cláusula where.');
    }
    if (
      Array.isArray(whereTenantId.in) &&
      whereTenantId.in.some((item) => typeof item === 'string' && item !== tenantId)
    ) {
      throw new CrossTenantAccessError('Conflicto de tenantId.in en cláusula where.');
    }
  }

  for (const key of COMPOUND_TENANT_UNIQUE_KEYS) {
    const compound = where[key];
    if (isRecord(compound) && typeof compound.tenantId === 'string') {
      if (compound.tenantId !== tenantId) {
        throw new CrossTenantAccessError(`Conflicto de tenantId en clave única ${key}.`);
      }
    }
  }

  if (isRecord(where.tenant)) {
    const directId = where.tenant.id;
    if (typeof directId === 'string' && directId !== tenantId) {
      throw new CrossTenantAccessError('Conflicto de tenant.id en cláusula where.');
    }
    if (isRecord(where.tenant.is) && typeof where.tenant.is.id === 'string') {
      if (where.tenant.is.id !== tenantId) {
        throw new CrossTenantAccessError('Conflicto de tenant.is.id en cláusula where.');
      }
    }
  }
}

function sanitizeCreateData(data: unknown, tenantId: string): UnknownRecord {
  const row: UnknownRecord = isRecord(data) ? { ...data } : {};

  if (row.tenantId !== undefined && row.tenantId !== tenantId) {
    throw new CrossTenantAccessError('No se puede crear un registro para otro tenantId.');
  }

  if (row.tenant !== undefined) {
    if (!isRecord(row.tenant)) {
      throw new CrossTenantAccessError('Relación tenant inválida en operación create.');
    }
    const keys = Object.keys(row.tenant);
    const connect = row.tenant.connect;
    if (
      keys.length !== 1 ||
      keys[0] !== 'connect' ||
      !isRecord(connect) ||
      Object.keys(connect).length !== 1 ||
      connect.id !== tenantId
    ) {
      throw new CrossTenantAccessError('Relación tenant.connect no coincide con el tenant activo.');
    }
    // CreateInput con relación `tenant` no admite `tenantId` escalar simultáneamente
    return row;
  }

  row.tenantId = tenantId;
  return row;
}

function assertNoTenantMutationInUpdateData(data: unknown, tenantId: string): void {
  if (!isRecord(data)) return;

  if (data.tenantId !== undefined) {
    const targetTenantId =
      typeof data.tenantId === 'string'
        ? data.tenantId
        : isRecord(data.tenantId)
          ? data.tenantId.set
          : undefined;
    if (targetTenantId !== tenantId) {
      throw new CrossTenantAccessError('No se permite mutar tenantId hacia otro tenant.');
    }
  }

  if (data.tenant !== undefined) {
    throw new CrossTenantAccessError('No se permite mutar la relación tenant en update.');
  }
}

function appendAndFilter(where: unknown, tenantFilter: UnknownRecord): UnknownRecord {
  const baseWhere: UnknownRecord = isRecord(where) ? { ...where } : {};
  const existingAnd = baseWhere.AND;
  if (Array.isArray(existingAnd)) {
    baseWhere.AND = [...existingAnd, tenantFilter];
  } else if (existingAnd !== undefined) {
    baseWhere.AND = [existingAnd, tenantFilter];
  } else {
    baseWhere.AND = [tenantFilter];
  }
  return baseWhere;
}

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

  private buildTenantFilter(modelName: string, tenantId: string): UnknownRecord {
    const childConfig = CHILD_TENANT_RELATION_MAP[modelName];
    if (childConfig) {
      return { [childConfig.relationField]: { tenantId } };
    }
    return { tenantId };
  }

  private async findRecordId(
    targetModel: string,
    where: UnknownRecord,
  ): Promise<{ id: string } | null> {
    const delegateKey = MODEL_TO_DELEGATE[targetModel];
    if (!delegateKey) {
      throw new CrossTenantAccessError(`Modelo referenciado (${targetModel}) no soportado.`);
    }
    const delegate = this[delegateKey] as unknown as {
      findFirst: (args: {
        where: UnknownRecord;
        select: { id: true };
      }) => Promise<{ id: string } | null>;
    };
    return delegate.findFirst({
      where,
      select: { id: true },
    });
  }

  private async verifyRecordBelongsToTenant(
    targetModel: string,
    where: UnknownRecord,
    tenantId: string,
    errorMessage?: string,
  ): Promise<void> {
    const isDirect = TENANT_SCOPED_MODELS.has(targetModel);
    const tenantFilter = this.buildTenantFilter(targetModel, tenantId);
    const scopedWhere =
      isDirect && Object.keys(where).length === 1 && typeof where.id === 'string'
        ? { id: where.id, tenantId }
        : appendAndFilter(where, tenantFilter);

    const record = await this.findRecordId(targetModel, scopedWhere);
    if (!record) {
      throw new CrossTenantAccessError(
        errorMessage ?? `El registro referenciado (${targetModel}) no pertenece al tenant activo.`,
      );
    }
  }

  private async verifyScalarForeignKeys(
    modelName: string,
    row: UnknownRecord,
    tenantId: string,
  ): Promise<void> {
    for (const [field, value] of Object.entries(row)) {
      if (value === undefined || value === null) {
        continue;
      }

      const targetModel =
        field === 'parentId' && modelName === 'Category'
          ? 'Category'
          : SCALAR_FK_TARGET_MODEL[field];

      if (!targetModel) {
        continue;
      }

      let fkId: string;
      if (typeof value === 'string') {
        if (!value) {
          throw new CrossTenantAccessError(`Referencia ${field} inválida.`);
        }
        fkId = value;
      } else if (isRecord(value)) {
        if (value.set === null || value.set === undefined) {
          continue;
        }
        if (typeof value.set === 'string' && value.set.length > 0) {
          fkId = value.set;
        } else {
          throw new CrossTenantAccessError(`Operación inválida sobre clave foránea ${field}.`);
        }
      } else {
        throw new CrossTenantAccessError(`Valor inválido para clave foránea ${field}.`);
      }

      await this.verifyRecordBelongsToTenant(
        targetModel,
        { id: fkId },
        tenantId,
        `La referencia ${field} (${fkId}) no pertenece al tenant activo.`,
      );
    }
  }

  private assertValidChildWritePayload(
    modelName: string,
    row: UnknownRecord,
    mode: 'create' | 'update',
    requireParentOnCreate: boolean,
  ): void {
    const config = CHILD_TENANT_RELATION_MAP[modelName];
    if (!config) return;

    if (mode === 'create' && requireParentOnCreate) {
      const fk = row[config.foreignKeyField];
      const rel = row[config.relationField];
      const hasFk = typeof fk === 'string' && fk.length > 0;
      const hasRel = isRecord(rel) && rel.connect !== undefined;
      if (!hasFk && !hasRel) {
        throw new CrossTenantAccessError(
          `La creación requiere ${config.foreignKeyField} perteneciente al tenant activo.`,
        );
      }
    }

    if (mode === 'update') {
      const fk = row[config.foreignKeyField];
      if (fk === null || (isRecord(fk) && fk.set === null)) {
        throw new CrossTenantAccessError(`Actualización inválida de ${config.relationField}.`);
      }
      const rel = row[config.relationField];
      if (isRecord(rel) && (rel.disconnect !== undefined || rel.delete !== undefined)) {
        throw new CrossTenantAccessError(`Actualización inválida de ${config.relationField}.`);
      }
      if (config.hasVariantField) {
        const vfk = row.variantId;
        if (vfk === null || (isRecord(vfk) && vfk.set === null)) {
          throw new CrossTenantAccessError('Actualización inválida de variant.');
        }
      }
    }
  }

  private async sanitizeWriteRow(
    modelName: string,
    rawData: unknown,
    tenantId: string,
    mode: 'create' | 'update',
    requireChildParentOnCreate: boolean,
  ): Promise<UnknownRecord> {
    if (!isRecord(rawData)) {
      throw new CrossTenantAccessError(`Payload inválido en operación ${mode} sobre ${modelName}.`);
    }

    let row: UnknownRecord;
    if (mode === 'create') {
      row = TENANT_SCOPED_MODELS.has(modelName)
        ? sanitizeCreateData(rawData, tenantId)
        : { ...rawData };
    } else {
      if (TENANT_SCOPED_MODELS.has(modelName)) {
        assertNoTenantMutationInUpdateData(rawData, tenantId);
      }
      row = { ...rawData };
    }

    this.assertValidChildWritePayload(modelName, row, mode, requireChildParentOnCreate);
    await this.verifyScalarForeignKeys(modelName, row, tenantId);
    await this.sanitizeNestedRelations(modelName, row, tenantId);

    return row;
  }

  private async sanitizeWriteData(
    modelName: string,
    data: unknown,
    tenantId: string,
    mode: 'create' | 'update',
  ): Promise<unknown> {
    if (Array.isArray(data)) {
      const sanitized: UnknownRecord[] = [];
      for (const item of data) {
        sanitized.push(await this.sanitizeWriteRow(modelName, item, tenantId, mode, true));
      }
      return sanitized;
    }
    return this.sanitizeWriteRow(modelName, data, tenantId, mode, true);
  }

  private async verifyWhereTargetsTenant(
    targetModel: string,
    whereItem: unknown,
    tenantId: string,
    allowMissing: boolean,
  ): Promise<UnknownRecord> {
    if (!isRecord(whereItem) || Object.keys(whereItem).length === 0) {
      throw new CrossTenantAccessError(
        `Cláusula where inválida en operación de relación sobre ${targetModel}.`,
      );
    }

    if (TENANT_SCOPED_MODELS.has(targetModel)) {
      assertNoConflictingTenantInWhere(whereItem, tenantId);
    }

    if (allowMissing) {
      const existing = await this.findRecordId(targetModel, whereItem);
      if (existing) {
        await this.verifyRecordBelongsToTenant(targetModel, whereItem, tenantId);
      }
    } else {
      await this.verifyRecordBelongsToTenant(targetModel, whereItem, tenantId);
    }

    return appendAndFilter(whereItem, this.buildTenantFilter(targetModel, tenantId));
  }

  private async sanitizeNestedRelations(
    modelName: string,
    row: UnknownRecord,
    tenantId: string,
  ): Promise<void> {
    const relationMap = MODEL_RELATIONS[modelName];
    if (!relationMap) {
      return;
    }

    for (const [relField, targetModel] of Object.entries(relationMap)) {
      const rawRel = row[relField];
      if (rawRel === undefined || rawRel === null) {
        continue;
      }
      if (!isRecord(rawRel)) {
        throw new CrossTenantAccessError(`Operación inválida en relación ${relField}.`);
      }

      const relInput: UnknownRecord = { ...rawRel };
      for (const action of Object.keys(relInput)) {
        if (!ALLOWED_NESTED_RELATION_ACTIONS.has(action)) {
          throw new CrossTenantAccessError(
            `Operación de relación no permitida (${relField}.${action}).`,
          );
        }
      }

      if (relInput.create !== undefined) {
        if (Array.isArray(relInput.create)) {
          const sanitized: UnknownRecord[] = [];
          for (const item of relInput.create) {
            sanitized.push(
              await this.sanitizeWriteRow(targetModel, item, tenantId, 'create', false),
            );
          }
          relInput.create = sanitized;
        } else {
          relInput.create = await this.sanitizeWriteRow(
            targetModel,
            relInput.create,
            tenantId,
            'create',
            false,
          );
        }
      }

      if (relInput.createMany !== undefined) {
        if (!isRecord(relInput.createMany) || relInput.createMany.data === undefined) {
          throw new CrossTenantAccessError(`Operación inválida en ${relField}.createMany.`);
        }
        const createManyCopy: UnknownRecord = { ...relInput.createMany };
        if (Array.isArray(createManyCopy.data)) {
          const sanitized: UnknownRecord[] = [];
          for (const item of createManyCopy.data) {
            sanitized.push(
              await this.sanitizeWriteRow(targetModel, item, tenantId, 'create', false),
            );
          }
          createManyCopy.data = sanitized;
        } else {
          createManyCopy.data = await this.sanitizeWriteRow(
            targetModel,
            createManyCopy.data,
            tenantId,
            'create',
            false,
          );
        }
        relInput.createMany = createManyCopy;
      }

      if (relInput.connect !== undefined) {
        const targets = Array.isArray(relInput.connect) ? relInput.connect : [relInput.connect];
        for (const targetWhere of targets) {
          await this.verifyWhereTargetsTenant(targetModel, targetWhere, tenantId, false);
        }
      }

      if (relInput.set !== undefined) {
        const targets = Array.isArray(relInput.set) ? relInput.set : [relInput.set];
        for (const targetWhere of targets) {
          await this.verifyWhereTargetsTenant(targetModel, targetWhere, tenantId, false);
        }
      }

      if (relInput.disconnect !== undefined && typeof relInput.disconnect !== 'boolean') {
        const targets = Array.isArray(relInput.disconnect)
          ? relInput.disconnect
          : [relInput.disconnect];
        for (const targetWhere of targets) {
          await this.verifyWhereTargetsTenant(targetModel, targetWhere, tenantId, false);
        }
      }

      if (relInput.delete !== undefined && typeof relInput.delete !== 'boolean') {
        const targets = Array.isArray(relInput.delete) ? relInput.delete : [relInput.delete];
        for (const targetWhere of targets) {
          await this.verifyWhereTargetsTenant(targetModel, targetWhere, tenantId, false);
        }
      }

      if (relInput.deleteMany !== undefined) {
        const isDirectTenantTarget = TENANT_SCOPED_MODELS.has(targetModel);
        const tenantFilter = isDirectTenantTarget
          ? this.buildTenantFilter(targetModel, tenantId)
          : undefined;
        const scopeFilter = (filter: unknown): UnknownRecord => {
          if (!isRecord(filter)) {
            throw new CrossTenantAccessError(`Cláusula inválida en ${relField}.deleteMany.`);
          }
          if (!isDirectTenantTarget || !tenantFilter) {
            return filter;
          }
          assertNoConflictingTenantInWhere(filter, tenantId);
          return Object.keys(filter).length > 0
            ? appendAndFilter(filter, tenantFilter)
            : tenantFilter;
        };
        relInput.deleteMany = Array.isArray(relInput.deleteMany)
          ? relInput.deleteMany.map(scopeFilter)
          : scopeFilter(relInput.deleteMany);
      }

      if (relInput.connectOrCreate !== undefined) {
        const entries = Array.isArray(relInput.connectOrCreate)
          ? relInput.connectOrCreate
          : [relInput.connectOrCreate];
        const sanitizedEntries: UnknownRecord[] = [];
        for (const entry of entries) {
          if (!isRecord(entry) || !isRecord(entry.where) || !isRecord(entry.create)) {
            throw new CrossTenantAccessError(`Operación inválida en ${relField}.connectOrCreate.`);
          }
          await this.verifyWhereTargetsTenant(targetModel, entry.where, tenantId, true);
          const sanitizedCreate = await this.sanitizeWriteRow(
            targetModel,
            entry.create,
            tenantId,
            'create',
            false,
          );
          sanitizedEntries.push({ ...entry, create: sanitizedCreate });
        }
        relInput.connectOrCreate = Array.isArray(relInput.connectOrCreate)
          ? sanitizedEntries
          : sanitizedEntries[0];
      }

      if (relInput.update !== undefined) {
        const isArray = Array.isArray(relInput.update);
        const entries = isArray ? (relInput.update as unknown[]) : [relInput.update];
        const sanitizedEntries: UnknownRecord[] = [];
        for (const entry of entries) {
          if (!isRecord(entry)) {
            throw new CrossTenantAccessError(`Operación inválida en ${relField}.update.`);
          }
          if ('data' in entry && isRecord(entry.data)) {
            let scopedWhere: UnknownRecord | undefined;
            if (entry.where !== undefined) {
              scopedWhere = await this.verifyWhereTargetsTenant(
                targetModel,
                entry.where,
                tenantId,
                false,
              );
            }
            const sanitizedData = await this.sanitizeWriteRow(
              targetModel,
              entry.data,
              tenantId,
              'update',
              false,
            );
            sanitizedEntries.push({
              ...entry,
              ...(scopedWhere !== undefined ? { where: scopedWhere } : {}),
              data: sanitizedData,
            });
          } else {
            if (isArray) {
              throw new CrossTenantAccessError(`Operación inválida en ${relField}.update.`);
            }
            sanitizedEntries.push(
              await this.sanitizeWriteRow(targetModel, entry, tenantId, 'update', false),
            );
          }
        }
        relInput.update = isArray ? sanitizedEntries : sanitizedEntries[0];
      }

      if (relInput.updateMany !== undefined) {
        const isArray = Array.isArray(relInput.updateMany);
        const entries = isArray ? (relInput.updateMany as unknown[]) : [relInput.updateMany];
        const isDirectTenantTarget = TENANT_SCOPED_MODELS.has(targetModel);
        const tenantFilter = isDirectTenantTarget
          ? this.buildTenantFilter(targetModel, tenantId)
          : undefined;
        const sanitizedEntries: UnknownRecord[] = [];
        for (const entry of entries) {
          if (!isRecord(entry) || !isRecord(entry.data)) {
            throw new CrossTenantAccessError(`Operación inválida en ${relField}.updateMany.`);
          }
          if (entry.where !== undefined && !isRecord(entry.where)) {
            throw new CrossTenantAccessError(`Cláusula inválida en ${relField}.updateMany.`);
          }
          let scopedWhere = entry.where;
          if (isDirectTenantTarget && tenantFilter) {
            if (entry.where) {
              assertNoConflictingTenantInWhere(entry.where, tenantId);
            }
            scopedWhere =
              isRecord(entry.where) && Object.keys(entry.where).length > 0
                ? appendAndFilter(entry.where, tenantFilter)
                : tenantFilter;
          }
          const sanitizedData = await this.sanitizeWriteRow(
            targetModel,
            entry.data,
            tenantId,
            'update',
            false,
          );
          sanitizedEntries.push({
            ...entry,
            ...(scopedWhere !== undefined ? { where: scopedWhere } : {}),
            data: sanitizedData,
          });
        }
        relInput.updateMany = isArray ? sanitizedEntries : sanitizedEntries[0];
      }

      if (relInput.upsert !== undefined) {
        const isArray = Array.isArray(relInput.upsert);
        const entries = isArray ? (relInput.upsert as unknown[]) : [relInput.upsert];
        const sanitizedEntries: UnknownRecord[] = [];
        for (const entry of entries) {
          if (!isRecord(entry) || !isRecord(entry.create) || !isRecord(entry.update)) {
            throw new CrossTenantAccessError(`Operación inválida en ${relField}.upsert.`);
          }
          let scopedWhere: UnknownRecord | undefined;
          if (entry.where !== undefined) {
            scopedWhere = await this.verifyWhereTargetsTenant(
              targetModel,
              entry.where,
              tenantId,
              true,
            );
          }
          const sanitizedCreate = await this.sanitizeWriteRow(
            targetModel,
            entry.create,
            tenantId,
            'create',
            false,
          );
          const sanitizedUpdate = await this.sanitizeWriteRow(
            targetModel,
            entry.update,
            tenantId,
            'update',
            false,
          );
          sanitizedEntries.push({
            ...entry,
            ...(scopedWhere !== undefined ? { where: scopedWhere } : {}),
            create: sanitizedCreate,
            update: sanitizedUpdate,
          });
        }
        relInput.upsert = isArray ? sanitizedEntries : sanitizedEntries[0];
      }

      row[relField] = relInput;
    }
  }

  /**
   * Retorna un cliente Prisma extendido que fuerza el aislamiento por tenantId
   * en todas las operaciones sobre modelos Multi-Tenant para evitar fugas de datos.
   */
  forTenant(tenantId: string) {
    if (!tenantId || typeof tenantId !== 'string' || !tenantId.trim()) {
      throw new Error('Se intentó instanciar PrismaService.forTenant sin un tenantId válido.');
    }

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const basePrisma = this;

    return this.$extends({
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            const isDirectTenantModel = Boolean(model && TENANT_SCOPED_MODELS.has(model));
            const childConfig = model ? CHILD_TENANT_RELATION_MAP[model] : undefined;

            if (!model || (!isDirectTenantModel && !childConfig)) {
              return query(args);
            }

            const mutableArgs: UnknownRecord = isRecord(args) ? { ...args } : {};
            const tenantFilter: UnknownRecord = childConfig
              ? { [childConfig.relationField]: { tenantId } }
              : { tenantId };

            if (FILTER_OPERATIONS.has(operation)) {
              if (isDirectTenantModel) {
                assertNoConflictingTenantInWhere(mutableArgs.where, tenantId);
              }
              if (operation === 'updateMany' || operation === 'updateManyAndReturn') {
                mutableArgs.data = await basePrisma.sanitizeWriteData(
                  model,
                  mutableArgs.data,
                  tenantId,
                  'update',
                );
              }

              mutableArgs.where = mutableArgs.where
                ? { AND: [mutableArgs.where, tenantFilter] }
                : tenantFilter;
              return query(mutableArgs);
            }

            if (UNIQUE_OPERATIONS.has(operation)) {
              if (isDirectTenantModel) {
                assertNoConflictingTenantInWhere(mutableArgs.where, tenantId);
              }

              if (operation === 'update') {
                mutableArgs.data = await basePrisma.sanitizeWriteData(
                  model,
                  mutableArgs.data,
                  tenantId,
                  'update',
                );
              } else if (operation === 'upsert') {
                mutableArgs.create = await basePrisma.sanitizeWriteData(
                  model,
                  mutableArgs.create,
                  tenantId,
                  'create',
                );
                mutableArgs.update = await basePrisma.sanitizeWriteData(
                  model,
                  mutableArgs.update,
                  tenantId,
                  'update',
                );
              }

              mutableArgs.where = appendAndFilter(mutableArgs.where, tenantFilter);
              return query(mutableArgs);
            }

            if (CREATE_OPERATIONS.has(operation)) {
              mutableArgs.data = await basePrisma.sanitizeWriteData(
                model,
                mutableArgs.data,
                tenantId,
                'create',
              );
              return query(mutableArgs);
            }

            return query(args);
          },
        },
      },
    });
  }
}

export type TenantPrismaClient = ReturnType<PrismaService['forTenant']>;
