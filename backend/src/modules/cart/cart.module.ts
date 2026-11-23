import { Module } from '@nestjs/common';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';
import { StorefrontModule } from '../storefront/storefront.module';

export const GUEST_CART_MERGER = 'GUEST_CART_MERGER';

@Module({
  imports: [StorefrontModule],
  controllers: [CartController],
  providers: [CartService, { provide: GUEST_CART_MERGER, useExisting: CartService }],
  exports: [CartService, GUEST_CART_MERGER],
})
export class CartModule {}
