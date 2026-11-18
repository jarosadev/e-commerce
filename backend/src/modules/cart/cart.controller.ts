import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { OptionalAuth } from '../../common/decorators/optional-auth.decorator';
import { RequireTenant } from '../../common/decorators/require-tenant.decorator';
import { CartService } from './cart.service';
import { AddCartItemDto } from './dto/cart.dto';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ResolvedTenantContext, AuthenticatedUserContext } from '../../common/cls/cls.types';
import { Request } from 'express';
import { Req } from '@nestjs/common';

@ApiTags('Cart')
@Controller('cart')
@RequireTenant()
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Post('items')
  @OptionalAuth()
  addItem(
    @CurrentTenant() tenant: ResolvedTenantContext,
    @CurrentUser() user: AuthenticatedUserContext | undefined,
    @Req() req: Request,
    @Body() dto: AddCartItemDto,
  ) {
    const guestToken = req.cookies?.guest_cart_token || (req.headers['x-guest-token'] as string);
    return this.cartService.addItem(tenant, user, guestToken, dto);
  }
}
