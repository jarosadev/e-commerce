import { Prisma, DiscountType } from '@prisma/client';
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ValidateCouponDto, StorefrontProductsQueryDto } from './dto/storefront.dto';

@Injectable()
export class StorefrontService {
  constructor(private readonly prisma: PrismaService) {}

  async getConfig(tenantId: string) {
    const db = this.prisma.forTenant(tenantId);
    const tenant = await db.tenant.findUnique({
      where: { id: tenantId },
      include: {
        theme: true,
        customDomains: true,
      },
    });

    if (!tenant) throw new NotFoundException('Tienda no encontrada.');

    const paymentMethods = await db.storePaymentMethod.findMany({
      where: { tenantId, isActive: true },
    });
    const shippingZones = await db.shippingZone.findMany({ where: { tenantId, isActive: true } });

    return {
      ...tenant,
      paymentMethods,
      shippingZones,
    };
  }

  async validateCoupon(tenantId: string, dto: ValidateCouponDto) {
    const db = this.prisma.forTenant(tenantId);
    const coupon = await db.coupon.findUnique({
      where: { tenantId_code: { tenantId, code: dto.code } },
    });

    if (!coupon || !coupon.isActive) throw new NotFoundException('Cupón no encontrado o inválido.');
    if (coupon.expiresAt && coupon.expiresAt < new Date())
      throw new BadRequestException('Cupón expirado.');
    if (coupon.maxUses && coupon.usedCount >= coupon.maxUses)
      throw new BadRequestException('Cupón agotado.');
    if (
      coupon.minPurchaseAmount &&
      dto.subtotal !== undefined &&
      dto.subtotal < Number(coupon.minPurchaseAmount)
    ) {
      throw new BadRequestException('Subtotal insuficiente para aplicar cupón.');
    }

    let discountAmount: number;
    if (coupon.discountType === DiscountType.PERCENTAGE) {
      discountAmount = (dto.subtotal ?? 0) * (Number(coupon.value) / 100);
    } else {
      discountAmount = Number(coupon.value);
    }

    return {
      valid: true,
      code: coupon.code,
      discountType: coupon.discountType,
      value: Number(coupon.value),
      discountAmount: Math.round(discountAmount * 100) / 100,
      finalSubtotal: Math.round(((dto.subtotal ?? 0) - discountAmount) * 100) / 100,
      minPurchaseAmount: coupon.minPurchaseAmount ? Number(coupon.minPurchaseAmount) : null,
    };
  }

  async listProducts(tenantId: string, query: StorefrontProductsQueryDto) {
    const { search, categoryId, page = 1, limit = 20 } = query;
    const db = this.prisma.forTenant(tenantId);
    const skip = (page - 1) * limit;
    const where: Prisma.ProductWhereInput = { isActive: true };
    if (search) where.name = { contains: search, mode: 'insensitive' };
    if (categoryId) where.categoryId = categoryId;

    const [items, total] = await Promise.all([
      db.product.findMany({ where, skip, take: limit, include: { variants: true } }),
      db.product.count({ where }),
    ]);
    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getProductBySlug(tenantId: string, slug: string) {
    const db = this.prisma.forTenant(tenantId);
    const product = await db.product.findFirst({
      where: { tenantId, slug, isActive: true },
      include: { variants: true, category: true },
    });
    if (!product) throw new NotFoundException('Producto no encontrado.');
    return product;
  }
}
