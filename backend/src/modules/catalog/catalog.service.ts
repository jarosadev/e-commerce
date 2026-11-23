import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PlatformRole, Prisma, TenantMemberRole } from '@prisma/client';
import { AuthenticatedUserContext, ResolvedTenantContext } from '../../common/cls/cls.types';
import { PrismaService } from '../../database/prisma.service';
import { PlanQuotaService } from '../plans/plan-quota.service';
import {
  AdjustStockDto,
  CreateCategoryDto,
  CreateProductDto,
  CreateVariantDto,
  GenerateVariantMatrixDto,
  ListCatalogProductsQueryDto,
  ReplaceWholesaleTiersDto,
  StockAdjustmentMode,
  UpdateCategoryDto,
  UpdateProductDto,
  UpdateVariantDto,
  WholesaleTierInputDto,
} from './dto/catalog.dto';

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function skuSegment(value: string): string {
  const clean = value
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/g, '');
  return (clean || 'VAR').slice(0, 6);
}

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly planQuotaService: PlanQuotaService,
  ) {}

  // ============================================================================
  // CATEGORIES
  // ============================================================================

  async listCategories(tenant: ResolvedTenantContext, user: AuthenticatedUserContext) {
    await this.assertTenantAccess(tenant, user, [
      TenantMemberRole.OWNER,
      TenantMemberRole.ADMIN,
      TenantMemberRole.STAFF,
    ]);

    const db = this.prisma.forTenant(tenant.id);
    return db.category.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        parent: { select: { id: true, name: true, slug: true } },
        _count: { select: { products: true, children: true } },
      },
    });
  }

  async createCategory(
    tenant: ResolvedTenantContext,
    user: AuthenticatedUserContext,
    dto: CreateCategoryDto,
  ) {
    await this.assertTenantAccess(tenant, user, [TenantMemberRole.OWNER, TenantMemberRole.ADMIN]);
    const db = this.prisma.forTenant(tenant.id);

    const slug = slugify(dto.slug || dto.name);
    if (!slug) {
      throw new BadRequestException('No se pudo generar un slug válido para la categoría.');
    }

    if (dto.parentId) {
      const parent = await db.category.findFirst({ where: { id: dto.parentId } });
      if (!parent) {
        throw new NotFoundException('La categoría padre indicada no pertenece a esta tienda.');
      }
    }

    try {
      return await db.category.create({
        data: {
          tenantId: tenant.id,
          name: dto.name,
          slug,
          parentId: dto.parentId ?? null,
          description: dto.description ?? null,
          imageUrl: dto.imageUrl ?? null,
          sortOrder: dto.sortOrder ?? 0,
          isActive: dto.isActive ?? true,
        },
        include: {
          parent: { select: { id: true, name: true, slug: true } },
          _count: { select: { products: true, children: true } },
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(`Ya existe una categoría con el slug "${slug}" en tu tienda.`);
      }
      throw error;
    }
  }

  async updateCategory(
    tenant: ResolvedTenantContext,
    user: AuthenticatedUserContext,
    categoryId: string,
    dto: UpdateCategoryDto,
  ) {
    await this.assertTenantAccess(tenant, user, [TenantMemberRole.OWNER, TenantMemberRole.ADMIN]);
    const db = this.prisma.forTenant(tenant.id);

    const existing = await db.category.findFirst({ where: { id: categoryId } });
    if (!existing) {
      throw new NotFoundException('Categoría no encontrada.');
    }

    if (dto.parentId !== undefined && dto.parentId !== null) {
      if (dto.parentId === categoryId) {
        throw new BadRequestException('Una categoría no puede ser su propia categoría padre.');
      }
      const parent = await db.category.findFirst({ where: { id: dto.parentId } });
      if (!parent) {
        throw new NotFoundException('La categoría padre indicada no pertenece a esta tienda.');
      }
    }

    const nextSlug = dto.slug !== undefined ? slugify(dto.slug) : undefined;
    if (nextSlug !== undefined && !nextSlug) {
      throw new BadRequestException('El slug de categoría no es válido.');
    }

    try {
      return await db.category.update({
        where: { id: categoryId },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(nextSlug !== undefined ? { slug: nextSlug } : {}),
          ...(dto.parentId !== undefined ? { parentId: dto.parentId } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.imageUrl !== undefined ? { imageUrl: dto.imageUrl } : {}),
          ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
        include: {
          parent: { select: { id: true, name: true, slug: true } },
          _count: { select: { products: true, children: true } },
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Ya existe otra categoría con ese mismo slug.');
      }
      throw error;
    }
  }

  async deleteCategory(
    tenant: ResolvedTenantContext,
    user: AuthenticatedUserContext,
    categoryId: string,
  ) {
    await this.assertTenantAccess(tenant, user, [TenantMemberRole.OWNER, TenantMemberRole.ADMIN]);
    const db = this.prisma.forTenant(tenant.id);

    const existing = await db.category.findFirst({ where: { id: categoryId } });
    if (!existing) {
      throw new NotFoundException('Categoría no encontrada.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.category.updateMany({
        where: { tenantId: tenant.id, parentId: categoryId },
        data: { parentId: null },
      });
      await tx.product.updateMany({
        where: { tenantId: tenant.id, categoryId },
        data: { categoryId: null },
      });
      await tx.category.delete({ where: { id: categoryId } });
    });

    return { deleted: true, id: categoryId };
  }

  // ============================================================================
  // PRODUCTS
  // ============================================================================

  async listProducts(
    tenant: ResolvedTenantContext,
    user: AuthenticatedUserContext,
    query: ListCatalogProductsQueryDto,
  ) {
    await this.assertTenantAccess(tenant, user, [
      TenantMemberRole.OWNER,
      TenantMemberRole.ADMIN,
      TenantMemberRole.STAFF,
    ]);

    const { search, categoryId, isActive, isWholesaleOnly, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;
    const db = this.prisma.forTenant(tenant.id);

    const where: Prisma.ProductWhereInput = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { brand: { contains: search, mode: 'insensitive' } },
        { variants: { some: { sku: { contains: search, mode: 'insensitive' } } } },
      ];
    }
    if (categoryId) where.categoryId = categoryId;
    if (isActive !== undefined) where.isActive = isActive;
    if (isWholesaleOnly !== undefined) where.isWholesaleOnly = isWholesaleOnly;

    const [items, total] = await Promise.all([
      db.product.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          category: { select: { id: true, name: true, slug: true } },
          images: { orderBy: { sortOrder: 'asc' } },
          variants: { orderBy: { createdAt: 'asc' } },
          wholesaleTiers: { orderBy: { minQuantity: 'asc' } },
        },
      }),
      db.product.count({ where }),
    ]);

    return {
      items: items.map((p) => this.serializeProduct(p)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getProductById(
    tenant: ResolvedTenantContext,
    user: AuthenticatedUserContext,
    productId: string,
  ) {
    await this.assertTenantAccess(tenant, user, [
      TenantMemberRole.OWNER,
      TenantMemberRole.ADMIN,
      TenantMemberRole.STAFF,
    ]);

    const product = await this.prisma.forTenant(tenant.id).product.findFirst({
      where: { id: productId },
      include: {
        category: { select: { id: true, name: true, slug: true } },
        images: { orderBy: { sortOrder: 'asc' } },
        variants: { orderBy: { createdAt: 'asc' } },
        wholesaleTiers: { orderBy: { minQuantity: 'asc' } },
      },
    });

    if (!product) {
      throw new NotFoundException('Producto no encontrado en esta tienda.');
    }

    return this.serializeProduct(product);
  }

  async createProduct(
    tenant: ResolvedTenantContext,
    user: AuthenticatedUserContext,
    dto: CreateProductDto,
  ) {
    await this.assertTenantAccess(tenant, user, [TenantMemberRole.OWNER, TenantMemberRole.ADMIN]);

    const slug = slugify(dto.slug || dto.name);
    if (!slug) {
      throw new BadRequestException('No se pudo generar un slug válido para el producto.');
    }

    if (dto.categoryId) {
      const cat = await this.prisma
        .forTenant(tenant.id)
        .category.findFirst({ where: { id: dto.categoryId } });
      if (!cat) {
        throw new NotFoundException('La categoría seleccionada no pertenece a esta tienda.');
      }
    }

    if (dto.wholesaleTiers && dto.wholesaleTiers.length > 0) {
      await this.planQuotaService.assertFeature(tenant.id, 'allowWholesale');
      this.validateWholesaleTiers(dto.wholesaleTiers);
    }

    try {
      const created = await this.prisma.product.create({
        data: {
          tenantId: tenant.id,
          categoryId: dto.categoryId ?? null,
          name: dto.name,
          slug,
          shortDescription: dto.shortDescription ?? null,
          description: dto.description ?? null,
          brand: dto.brand ?? null,
          isWholesaleOnly: dto.isWholesaleOnly ?? false,
          minOrderQty: dto.minOrderQty ?? 1,
          isFeatured: dto.isFeatured ?? false,
          isActive: dto.isActive ?? true,
          ...(dto.images && dto.images.length > 0
            ? {
                images: {
                  create: dto.images.map((img, idx) => ({
                    tenantId: tenant.id,
                    url: img.url,
                    altText: img.altText ?? null,
                    sortOrder: img.sortOrder ?? idx,
                  })),
                },
              }
            : {}),
          ...(dto.variants && dto.variants.length > 0
            ? {
                variants: {
                  create: dto.variants.map((v) => ({
                    tenantId: tenant.id,
                    sku: v.sku.trim().toUpperCase(),
                    title: v.title,
                    attributes: v.attributes as Prisma.InputJsonValue,
                    retailPrice: v.retailPrice,
                    compareAtPrice: v.compareAtPrice ?? null,
                    stockOnHand: v.stockOnHand ?? 0,
                    lowStockThreshold: v.lowStockThreshold ?? 5,
                    weightGrams: v.weightGrams ?? null,
                    isActive: v.isActive ?? true,
                  })),
                },
              }
            : {}),
          ...(dto.wholesaleTiers && dto.wholesaleTiers.length > 0
            ? {
                wholesaleTiers: {
                  create: dto.wholesaleTiers.map((tier) => ({
                    tenantId: tenant.id,
                    minQuantity: tier.minQuantity,
                    maxQuantity: tier.maxQuantity ?? null,
                    unitPrice: tier.unitPrice,
                    label: tier.label ?? null,
                  })),
                },
              }
            : {}),
        },
        include: {
          category: { select: { id: true, name: true, slug: true } },
          images: { orderBy: { sortOrder: 'asc' } },
          variants: { orderBy: { createdAt: 'asc' } },
          wholesaleTiers: { orderBy: { minQuantity: 'asc' } },
        },
      });

      return this.serializeProduct(created);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(
          'Ya existe un producto con ese slug o una variante con ese SKU en tu tienda.',
        );
      }
      throw error;
    }
  }

  async updateProduct(
    tenant: ResolvedTenantContext,
    user: AuthenticatedUserContext,
    productId: string,
    dto: UpdateProductDto,
  ) {
    await this.assertTenantAccess(tenant, user, [TenantMemberRole.OWNER, TenantMemberRole.ADMIN]);
    const db = this.prisma.forTenant(tenant.id);

    const existing = await db.product.findFirst({ where: { id: productId } });
    if (!existing) {
      throw new NotFoundException('Producto no encontrado en esta tienda.');
    }

    if (dto.categoryId !== undefined && dto.categoryId !== null) {
      const cat = await db.category.findFirst({ where: { id: dto.categoryId } });
      if (!cat) {
        throw new NotFoundException('La categoría seleccionada no pertenece a esta tienda.');
      }
    }

    const nextSlug = dto.slug !== undefined ? slugify(dto.slug) : undefined;
    if (nextSlug !== undefined && !nextSlug) {
      throw new BadRequestException('El slug de producto no es válido.');
    }

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        if (dto.images !== undefined) {
          await tx.productImage.deleteMany({
            where: { tenantId: tenant.id, productId },
          });
          if (dto.images.length > 0) {
            await tx.productImage.createMany({
              data: dto.images.map((img, idx) => ({
                tenantId: tenant.id,
                productId,
                url: img.url,
                altText: img.altText ?? null,
                sortOrder: img.sortOrder ?? idx,
              })),
            });
          }
        }

        return tx.product.update({
          where: { id: productId },
          data: {
            ...(dto.name !== undefined ? { name: dto.name } : {}),
            ...(nextSlug !== undefined ? { slug: nextSlug } : {}),
            ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
            ...(dto.shortDescription !== undefined
              ? { shortDescription: dto.shortDescription }
              : {}),
            ...(dto.description !== undefined ? { description: dto.description } : {}),
            ...(dto.brand !== undefined ? { brand: dto.brand } : {}),
            ...(dto.isWholesaleOnly !== undefined ? { isWholesaleOnly: dto.isWholesaleOnly } : {}),
            ...(dto.minOrderQty !== undefined ? { minOrderQty: dto.minOrderQty } : {}),
            ...(dto.isFeatured !== undefined ? { isFeatured: dto.isFeatured } : {}),
            ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          },
          include: {
            category: { select: { id: true, name: true, slug: true } },
            images: { orderBy: { sortOrder: 'asc' } },
            variants: { orderBy: { createdAt: 'asc' } },
            wholesaleTiers: { orderBy: { minQuantity: 'asc' } },
          },
        });
      });

      return this.serializeProduct(updated);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Ya existe otro producto con ese mismo slug.');
      }
      throw error;
    }
  }

  async deleteProduct(
    tenant: ResolvedTenantContext,
    user: AuthenticatedUserContext,
    productId: string,
  ) {
    await this.assertTenantAccess(tenant, user, [TenantMemberRole.OWNER, TenantMemberRole.ADMIN]);
    const db = this.prisma.forTenant(tenant.id);

    const existing = await db.product.findFirst({
      where: { id: productId },
      include: { variants: { select: { id: true } } },
    });
    if (!existing) {
      throw new NotFoundException('Producto no encontrado en esta tienda.');
    }

    const variantIds = existing.variants.map((v) => v.id);
    const linkedOrders =
      variantIds.length > 0
        ? await this.prisma.orderItem.count({ where: { variantId: { in: variantIds } } })
        : 0;

    if (linkedOrders > 0) {
      await db.product.update({
        where: { id: productId },
        data: { isActive: false },
      });
      return { deleted: false, archived: true, id: productId };
    }

    await db.product.delete({ where: { id: productId } });
    return { deleted: true, archived: false, id: productId };
  }

  // ============================================================================
  // VARIANTS, MATRIX GENERATOR & ATOMIC STOCK
  // ============================================================================

  async createVariant(
    tenant: ResolvedTenantContext,
    user: AuthenticatedUserContext,
    productId: string,
    dto: CreateVariantDto,
  ) {
    await this.assertTenantAccess(tenant, user, [TenantMemberRole.OWNER, TenantMemberRole.ADMIN]);
    const db = this.prisma.forTenant(tenant.id);

    const product = await db.product.findFirst({ where: { id: productId } });
    if (!product) {
      throw new NotFoundException('Producto no encontrado.');
    }

    try {
      const created = await db.productVariant.create({
        data: {
          tenantId: tenant.id,
          productId,
          sku: dto.sku.trim().toUpperCase(),
          title: dto.title,
          attributes: dto.attributes as Prisma.InputJsonValue,
          retailPrice: dto.retailPrice,
          compareAtPrice: dto.compareAtPrice ?? null,
          stockOnHand: dto.stockOnHand ?? 0,
          lowStockThreshold: dto.lowStockThreshold ?? 5,
          weightGrams: dto.weightGrams ?? null,
          isActive: dto.isActive ?? true,
        },
      });
      return this.serializeVariant(created);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(`El SKU "${dto.sku.toUpperCase()}" ya existe en tu tienda.`);
      }
      throw error;
    }
  }

  async generateVariantMatrix(
    tenant: ResolvedTenantContext,
    user: AuthenticatedUserContext,
    productId: string,
    dto: GenerateVariantMatrixDto,
  ) {
    await this.assertTenantAccess(tenant, user, [TenantMemberRole.OWNER, TenantMemberRole.ADMIN]);
    const db = this.prisma.forTenant(tenant.id);

    const product = await db.product.findFirst({ where: { id: productId } });
    if (!product) {
      throw new NotFoundException('Producto no encontrado.');
    }

    const sanitizedAxes = dto.axes.map((axis) => ({
      name: axis.name.trim(),
      values: Array.from(new Set(axis.values.map((v) => v.trim()).filter(Boolean))),
    }));

    if (sanitizedAxes.some((a) => a.values.length === 0)) {
      throw new BadRequestException('Cada eje de variantes debe contener al menos un valor.');
    }

    const totalCombinations = sanitizedAxes.reduce((acc, axis) => acc * axis.values.length, 1);
    if (totalCombinations > 100) {
      throw new BadRequestException(
        `La matriz genera ${totalCombinations} variantes y el máximo permitido por lote es 100.`,
      );
    }

    // Producto cartesiano de los ejes
    let combinations: Array<Record<string, string>> = [{}];
    for (const axis of sanitizedAxes) {
      const next: Array<Record<string, string>> = [];
      for (const combo of combinations) {
        for (const val of axis.values) {
          next.push({ ...combo, [axis.name]: val });
        }
      }
      combinations = next;
    }

    const prefix = dto.skuPrefix
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9-]+/g, '');
    const candidateRows = combinations.map((attrs) => {
      const entries = Object.entries(attrs);
      const title = entries.map(([, v]) => v).join(' · ');
      const sku = `${prefix}-${entries.map(([, v]) => skuSegment(v)).join('-')}`.slice(0, 80);
      return { sku, title, attributes: attrs };
    });

    const existingSkus = new Set(
      (
        await db.productVariant.findMany({
          where: { sku: { in: candidateRows.map((c) => c.sku) } },
          select: { sku: true },
        })
      ).map((v) => v.sku),
    );

    const toCreate = candidateRows.filter((row) => !existingSkus.has(row.sku));
    const createdVariants = await this.prisma.$transaction(async (tx) => {
      const created = [];
      for (const row of toCreate) {
        const variant = await tx.productVariant.create({
          data: {
            tenantId: tenant.id,
            productId,
            sku: row.sku,
            title: row.title,
            attributes: row.attributes as Prisma.InputJsonValue,
            retailPrice: dto.retailPrice,
            compareAtPrice: dto.compareAtPrice ?? null,
            stockOnHand: dto.stockOnHand ?? 0,
            lowStockThreshold: dto.lowStockThreshold ?? 5,
            weightGrams: dto.weightGrams ?? null,
          },
        });
        created.push(variant);
      }
      return created;
    });

    return {
      createdCount: createdVariants.length,
      skippedCount: candidateRows.length - createdVariants.length,
      variants: createdVariants.map((v) => this.serializeVariant(v)),
    };
  }

  async updateVariant(
    tenant: ResolvedTenantContext,
    user: AuthenticatedUserContext,
    variantId: string,
    dto: UpdateVariantDto,
  ) {
    await this.assertTenantAccess(tenant, user, [TenantMemberRole.OWNER, TenantMemberRole.ADMIN]);
    const db = this.prisma.forTenant(tenant.id);

    const existing = await db.productVariant.findFirst({ where: { id: variantId } });
    if (!existing) {
      throw new NotFoundException('Variante no encontrada en esta tienda.');
    }

    try {
      const updated = await db.productVariant.update({
        where: { id: variantId },
        data: {
          ...(dto.sku !== undefined ? { sku: dto.sku.trim().toUpperCase() } : {}),
          ...(dto.title !== undefined ? { title: dto.title } : {}),
          ...(dto.attributes !== undefined
            ? { attributes: dto.attributes as Prisma.InputJsonValue }
            : {}),
          ...(dto.retailPrice !== undefined ? { retailPrice: dto.retailPrice } : {}),
          ...(dto.compareAtPrice !== undefined ? { compareAtPrice: dto.compareAtPrice } : {}),
          ...(dto.lowStockThreshold !== undefined
            ? { lowStockThreshold: dto.lowStockThreshold }
            : {}),
          ...(dto.weightGrams !== undefined ? { weightGrams: dto.weightGrams } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
      });
      return this.serializeVariant(updated);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Ese SKU ya está asignado a otra variante de tu tienda.');
      }
      throw error;
    }
  }

  async adjustVariantStock(
    tenant: ResolvedTenantContext,
    user: AuthenticatedUserContext,
    variantId: string,
    dto: AdjustStockDto,
  ) {
    await this.assertTenantAccess(tenant, user, [
      TenantMemberRole.OWNER,
      TenantMemberRole.ADMIN,
      TenantMemberRole.STAFF,
    ]);

    const updated = await this.prisma.$transaction(async (tx) => {
      const variant = await tx.productVariant.findFirst({
        where: { id: variantId, tenantId: tenant.id },
      });
      if (!variant) {
        throw new NotFoundException('Variante no encontrada en esta tienda.');
      }

      const nextStock =
        dto.mode === StockAdjustmentMode.SET ? dto.quantity : variant.stockOnHand + dto.quantity;

      if (nextStock < 0) {
        throw new BadRequestException('El stock físico no puede ser negativo.');
      }

      if (nextStock < variant.stockReserved) {
        throw new ConflictException({
          code: 'STOCK_BELOW_RESERVED',
          message: `No puedes reducir el stock físico (${nextStock}) por debajo del stock reservado actual (${variant.stockReserved}).`,
        });
      }

      return tx.productVariant.update({
        where: { id: variantId },
        data: { stockOnHand: nextStock },
      });
    });

    return this.serializeVariant(updated);
  }

  async deleteVariant(
    tenant: ResolvedTenantContext,
    user: AuthenticatedUserContext,
    variantId: string,
  ) {
    await this.assertTenantAccess(tenant, user, [TenantMemberRole.OWNER, TenantMemberRole.ADMIN]);
    const db = this.prisma.forTenant(tenant.id);

    const existing = await db.productVariant.findFirst({ where: { id: variantId } });
    if (!existing) {
      throw new NotFoundException('Variante no encontrada en esta tienda.');
    }

    const linkedOrders = await this.prisma.orderItem.count({ where: { variantId } });
    if (linkedOrders > 0) {
      await db.productVariant.update({
        where: { id: variantId },
        data: { isActive: false },
      });
      return { deleted: false, archived: true, id: variantId };
    }

    await db.productVariant.delete({ where: { id: variantId } });
    return { deleted: true, archived: false, id: variantId };
  }

  async getLowStockAlerts(tenant: ResolvedTenantContext, user: AuthenticatedUserContext) {
    await this.assertTenantAccess(tenant, user, [
      TenantMemberRole.OWNER,
      TenantMemberRole.ADMIN,
      TenantMemberRole.STAFF,
    ]);

    const variants = await this.prisma.forTenant(tenant.id).productVariant.findMany({
      where: {
        isActive: true,
        product: { isActive: true },
      },
      include: {
        product: { select: { id: true, name: true, slug: true } },
      },
    });

    const alerts = variants
      .map((v) => {
        const availableStock = v.stockOnHand - v.stockReserved;
        return {
          variantId: v.id,
          productId: v.productId,
          productName: v.product.name,
          productSlug: v.product.slug,
          sku: v.sku,
          title: v.title,
          stockOnHand: v.stockOnHand,
          stockReserved: v.stockReserved,
          availableStock,
          lowStockThreshold: v.lowStockThreshold,
          isOutOfStock: availableStock <= 0,
        };
      })
      .filter((item) => item.availableStock <= item.lowStockThreshold)
      .sort((a, b) => a.availableStock - b.availableStock);

    return {
      totalAlerts: alerts.length,
      outOfStockCount: alerts.filter((a) => a.isOutOfStock).length,
      items: alerts,
    };
  }

  // ============================================================================
  // WHOLESALE B2B TIERS
  // ============================================================================

  async replaceWholesaleTiers(
    tenant: ResolvedTenantContext,
    user: AuthenticatedUserContext,
    productId: string,
    dto: ReplaceWholesaleTiersDto,
  ) {
    await this.assertTenantAccess(tenant, user, [TenantMemberRole.OWNER, TenantMemberRole.ADMIN]);
    const db = this.prisma.forTenant(tenant.id);

    const product = await db.product.findFirst({ where: { id: productId } });
    if (!product) {
      throw new NotFoundException('Producto no encontrado.');
    }

    const sortedTiers = this.validateWholesaleTiers(dto.tiers);

    const saved = await this.prisma.$transaction(async (tx) => {
      await tx.wholesaleTier.deleteMany({
        where: { tenantId: tenant.id, productId },
      });

      if (sortedTiers.length === 0) {
        return [];
      }

      const created = [];
      for (const tier of sortedTiers) {
        const row = await tx.wholesaleTier.create({
          data: {
            tenantId: tenant.id,
            productId,
            minQuantity: tier.minQuantity,
            maxQuantity: tier.maxQuantity ?? null,
            unitPrice: tier.unitPrice,
            label: tier.label ?? null,
          },
        });
        created.push(row);
      }
      return created;
    });

    return saved.map((t) => ({
      id: t.id,
      productId: t.productId,
      minQuantity: t.minQuantity,
      maxQuantity: t.maxQuantity,
      unitPrice: Number(t.unitPrice),
      label: t.label,
    }));
  }

  private validateWholesaleTiers(tiers: WholesaleTierInputDto[]): WholesaleTierInputDto[] {
    if (tiers.length === 0) return [];

    const sorted = [...tiers].sort((a, b) => a.minQuantity - b.minQuantity);

    for (let i = 0; i < sorted.length; i++) {
      const current = sorted[i];
      if (current.maxQuantity !== undefined && current.maxQuantity !== null) {
        if (current.maxQuantity < current.minQuantity) {
          throw new BadRequestException(
            `Tramo mayorista inválido: maxQuantity (${current.maxQuantity}) no puede ser menor a minQuantity (${current.minQuantity}).`,
          );
        }
      }

      if (i > 0) {
        const prev = sorted[i - 1];
        if (prev.maxQuantity === undefined || prev.maxQuantity === null) {
          throw new BadRequestException(
            `El tramo abierto desde ${prev.minQuantity}+ unidades debe ser el último tramo.`,
          );
        }
        if (current.minQuantity <= prev.maxQuantity) {
          throw new BadRequestException(
            `Solapamiento de tramos mayoristas entre [${prev.minQuantity}-${prev.maxQuantity}] y [${current.minQuantity}-${current.maxQuantity ?? '+'}].`,
          );
        }
      }
    }

    return sorted;
  }

  private async assertTenantAccess(
    tenant: ResolvedTenantContext,
    user: AuthenticatedUserContext,
    allowedRoles: TenantMemberRole[],
  ): Promise<void> {
    if (user.role === PlatformRole.SUPER_ADMIN || tenant.ownerId === user.sub) {
      return;
    }

    const membership = await this.prisma.forTenant(tenant.id).tenantMember.findUnique({
      where: {
        tenantId_userId: {
          tenantId: tenant.id,
          userId: user.sub,
        },
      },
    });

    if (!membership || !allowedRoles.includes(membership.role)) {
      throw new ForbiddenException(
        'No tienes permisos para administrar el catálogo de esta tienda.',
      );
    }
  }

  private serializeVariant(variant: {
    id: string;
    tenantId: string;
    productId: string;
    sku: string;
    title: string;
    attributes: Prisma.JsonValue;
    retailPrice: Prisma.Decimal;
    compareAtPrice: Prisma.Decimal | null;
    stockOnHand: number;
    stockReserved: number;
    lowStockThreshold: number;
    weightGrams: number | null;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      ...variant,
      retailPrice: Number(variant.retailPrice),
      compareAtPrice: variant.compareAtPrice !== null ? Number(variant.compareAtPrice) : null,
      availableStock: variant.stockOnHand - variant.stockReserved,
      isLowStock: variant.stockOnHand - variant.stockReserved <= variant.lowStockThreshold,
    };
  }

  private serializeProduct(product: {
    id: string;
    tenantId: string;
    categoryId: string | null;
    name: string;
    slug: string;
    shortDescription: string | null;
    description: string | null;
    brand: string | null;
    isWholesaleOnly: boolean;
    minOrderQty: number;
    isFeatured: boolean;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    category: { id: string; name: string; slug: string } | null;
    images: Array<{ id: string; url: string; altText: string | null; sortOrder: number }>;
    variants: Array<{
      id: string;
      tenantId: string;
      productId: string;
      sku: string;
      title: string;
      attributes: Prisma.JsonValue;
      retailPrice: Prisma.Decimal;
      compareAtPrice: Prisma.Decimal | null;
      stockOnHand: number;
      stockReserved: number;
      lowStockThreshold: number;
      weightGrams: number | null;
      isActive: boolean;
      createdAt: Date;
      updatedAt: Date;
    }>;
    wholesaleTiers: Array<{
      id: string;
      productId: string;
      minQuantity: number;
      maxQuantity: number | null;
      unitPrice: Prisma.Decimal;
      label: string | null;
    }>;
  }) {
    return {
      ...product,
      variants: product.variants.map((v) => this.serializeVariant(v)),
      wholesaleTiers: product.wholesaleTiers.map((t) => ({
        id: t.id,
        productId: t.productId,
        minQuantity: t.minQuantity,
        maxQuantity: t.maxQuantity,
        unitPrice: Number(t.unitPrice),
        label: t.label,
      })),
    };
  }
}
