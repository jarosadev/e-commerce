import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { RequireTenant } from '../../common/decorators/require-tenant.decorator';
import { StorefrontService } from './storefront.service';
import { ValidateCouponDto, StorefrontProductsQueryDto } from './dto/storefront.dto';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { ResolvedTenantContext } from '../../common/cls/cls.types';

@ApiTags('Storefront')
@Controller('storefront')
@Public()
@RequireTenant()
export class StorefrontController {
  constructor(private readonly storefrontService: StorefrontService) {}

  @Get('config')
  getConfig(@CurrentTenant() tenant: ResolvedTenantContext) {
    return this.storefrontService.getConfig(tenant.id);
  }

  @Get('products')
  listProducts(@CurrentTenant() tenant: ResolvedTenantContext, @Query() query: StorefrontProductsQueryDto) {
    return this.storefrontService.listProducts(tenant.id, query);
  }

  @Get('products/:slug')
  getProductBySlug(@CurrentTenant() tenant: ResolvedTenantContext, @Param('slug') slug: string) {
    return this.storefrontService.getProductBySlug(tenant.id, slug);
  }

  @Post('coupons/validate')
  @HttpCode(HttpStatus.OK)
  validateCoupon(@CurrentTenant() tenant: ResolvedTenantContext, @Body() dto: ValidateCouponDto) {
    return this.storefrontService.validateCoupon(tenant.id, dto);
  }
}
