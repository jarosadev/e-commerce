import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AddCartItemDto } from './dto/cart.dto';
import { ResolvedTenantContext, AuthenticatedUserContext } from '../../common/cls/cls.types';
import { CartStatus } from '@prisma/client';
import { randomUUID } from 'crypto';

@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}

  async addItem(
    tenant: ResolvedTenantContext,
    user: AuthenticatedUserContext | undefined,
    guestToken: string | undefined,
    dto: AddCartItemDto,
  ) {
    return await this.prisma.forTenant(tenant.id).$transaction(async (tx) => {
      const variant = await tx.productVariant.findFirst({
        where: { id: dto.variantId, tenantId: tenant.id, isActive: true },
        include: { product: true },
      });

      if (!variant || !variant.product.isActive) {
        throw new BadRequestException('Producto o variante no disponible.');
      }

      const availableStock = Math.max(0, variant.stockOnHand - variant.stockReserved);
      if (dto.quantity > availableStock) {
        throw new BadRequestException('Stock insuficiente.');
      }

      // Find or create cart
      let cart = await tx.cart.findFirst({
        where: user?.sub
          ? { customerId: user.sub, status: CartStatus.ACTIVE }
          : { guestToken, status: CartStatus.ACTIVE },
      });

      if (!cart) {
        cart = await tx.cart.create({
          data: {
            tenantId: tenant.id,
            customerId: user?.sub,
            guestToken: user?.sub ? undefined : (guestToken ?? randomUUID()),
            status: CartStatus.ACTIVE,
            lastActivityAt: new Date(),
          },
        });
      }

      await tx.cartItem.upsert({
        where: { cartId_variantId: { cartId: cart.id, variantId: dto.variantId } },
        update: { quantity: { increment: dto.quantity } },
        create: { cartId: cart.id, variantId: dto.variantId, quantity: dto.quantity },
      });

      return { message: 'Item added' };
    });
  }

  async mergeGuestCartOnLogin(params: {
    tenantId: string;
    customerId: string;
    guestToken: string;
  }): Promise<void> {
    const db = this.prisma.forTenant(params.tenantId);
    const guestCart = await db.cart.findFirst({
      where: { guestToken: params.guestToken, status: CartStatus.ACTIVE },
      include: { items: true },
    });
    if (!guestCart) return;

    const userCart =
      (await db.cart.findFirst({
        where: { customerId: params.customerId, status: CartStatus.ACTIVE },
      })) ??
      (await db.cart.create({
        data: {
          tenantId: params.tenantId,
          customerId: params.customerId,
          status: CartStatus.ACTIVE,
        },
      }));

    for (const item of guestCart.items) {
      await db.cartItem.upsert({
        where: { cartId_variantId: { cartId: userCart.id, variantId: item.variantId } },
        update: { quantity: { increment: item.quantity } },
        create: { cartId: userCart.id, variantId: item.variantId, quantity: item.quantity },
      });
    }
    await db.cart.delete({ where: { id: guestCart.id } });
  }

  async removeItem(tenant: ResolvedTenantContext, cartId: string, variantId: string) {
    await this.prisma.forTenant(tenant.id).cartItem.delete({
      where: { cartId_variantId: { cartId, variantId } },
    });
  }

  async updateItemQuantity(
    tenant: ResolvedTenantContext,
    cartId: string,
    variantId: string,
    quantity: number,
  ) {
    await this.prisma.forTenant(tenant.id).cartItem.update({
      where: { cartId_variantId: { cartId, variantId } },
      data: { quantity },
    });
  }

  async clearCart(tenant: ResolvedTenantContext, cartId: string) {
    await this.prisma.forTenant(tenant.id).cartItem.deleteMany({ where: { cartId } });
  }
}
