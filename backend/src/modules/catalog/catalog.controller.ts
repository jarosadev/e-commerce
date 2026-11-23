import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PlatformRole } from '@prisma/client';
import { AuthenticatedUserContext, ResolvedTenantContext } from '../../common/cls/cls.types';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  RequirePlanFeature,
  RequirePlanQuota,
} from '../../common/decorators/require-plan.decorator';
import { RequireTenant } from '../../common/decorators/require-tenant.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PlanQuotaGuard } from '../plans/guards/plan-quota.guard';
import { CatalogService } from './catalog.service';
import {
  AdjustStockDto,
  CreateCategoryDto,
  CreateProductDto,
  CreateVariantDto,
  GenerateVariantMatrixDto,
  ListCatalogProductsQueryDto,
  ReplaceWholesaleTiersDto,
  UpdateCategoryDto,
  UpdateProductDto,
  UpdateVariantDto,
} from './dto/catalog.dto';

@ApiTags('Catalog, Variants & Wholesale B2B')
@ApiBearerAuth('access-token')
@ApiCookieAuth('access_token')
@RequireTenant()
@Roles(PlatformRole.SUPER_ADMIN, PlatformRole.STORE_OWNER, PlatformRole.STORE_STAFF)
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  // ---- Categories ----

  @Get('categories')
  @ApiOperation({ summary: 'Lista categorías de la tienda actual ordenadas por sortOrder' })
  listCategories(
    @CurrentTenant() tenant: ResolvedTenantContext,
    @CurrentUser() user: AuthenticatedUserContext,
  ) {
    return this.catalogService.listCategories(tenant, user);
  }

  @Post('categories')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crea una categoría o subcategoría en la tienda actual' })
  createCategory(
    @CurrentTenant() tenant: ResolvedTenantContext,
    @CurrentUser() user: AuthenticatedUserContext,
    @Body() dto: CreateCategoryDto,
  ) {
    return this.catalogService.createCategory(tenant, user, dto);
  }

  @Patch('categories/:categoryId')
  @ApiOperation({ summary: 'Actualiza una categoría de la tienda actual' })
  updateCategory(
    @CurrentTenant() tenant: ResolvedTenantContext,
    @CurrentUser() user: AuthenticatedUserContext,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.catalogService.updateCategory(tenant, user, categoryId, dto);
  }

  @Delete('categories/:categoryId')
  @ApiOperation({ summary: 'Elimina una categoría desvinculando sus productos y subcategorías' })
  deleteCategory(
    @CurrentTenant() tenant: ResolvedTenantContext,
    @CurrentUser() user: AuthenticatedUserContext,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
  ) {
    return this.catalogService.deleteCategory(tenant, user, categoryId);
  }

  // ---- Products ----

  @Get('products')
  @ApiOperation({ summary: 'Lista productos del catálogo con variantes, galería y tramos B2B' })
  listProducts(
    @CurrentTenant() tenant: ResolvedTenantContext,
    @CurrentUser() user: AuthenticatedUserContext,
    @Query() query: ListCatalogProductsQueryDto,
  ) {
    return this.catalogService.listProducts(tenant, user, query);
  }

  @Get('products/:productId')
  @ApiOperation({ summary: 'Obtiene el detalle completo de un producto de la tienda' })
  getProductById(
    @CurrentTenant() tenant: ResolvedTenantContext,
    @CurrentUser() user: AuthenticatedUserContext,
    @Param('productId', ParseUUIDPipe) productId: string,
  ) {
    return this.catalogService.getProductById(tenant, user, productId);
  }

  @Post('products')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(PlanQuotaGuard)
  @RequirePlanQuota('products')
  @ApiOperation({
    summary:
      'Crea un producto (validando límite de productos del plan SaaS) con galería/variantes/B2B',
  })
  createProduct(
    @CurrentTenant() tenant: ResolvedTenantContext,
    @CurrentUser() user: AuthenticatedUserContext,
    @Body() dto: CreateProductDto,
  ) {
    return this.catalogService.createProduct(tenant, user, dto);
  }

  @Patch('products/:productId')
  @ApiOperation({ summary: 'Actualiza datos del producto y/o reemplaza el orden de su galería' })
  updateProduct(
    @CurrentTenant() tenant: ResolvedTenantContext,
    @CurrentUser() user: AuthenticatedUserContext,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.catalogService.updateProduct(tenant, user, productId, dto);
  }

  @Delete('products/:productId')
  @ApiOperation({
    summary: 'Elimina un producto o lo archiva si ya posee órdenes históricas asociadas',
  })
  deleteProduct(
    @CurrentTenant() tenant: ResolvedTenantContext,
    @CurrentUser() user: AuthenticatedUserContext,
    @Param('productId', ParseUUIDPipe) productId: string,
  ) {
    return this.catalogService.deleteProduct(tenant, user, productId);
  }

  // ---- Variants & Inventory ----

  @Post('products/:productId/variants')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crea una variante individual (talla/color/SKU/stock) en un producto' })
  createVariant(
    @CurrentTenant() tenant: ResolvedTenantContext,
    @CurrentUser() user: AuthenticatedUserContext,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: CreateVariantDto,
  ) {
    return this.catalogService.createVariant(tenant, user, productId, dto);
  }

  @Post('products/:productId/variants/matrix')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Genera automáticamente la matriz cartesiana de variantes (ej. Tallas × Colores)',
  })
  generateVariantMatrix(
    @CurrentTenant() tenant: ResolvedTenantContext,
    @CurrentUser() user: AuthenticatedUserContext,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: GenerateVariantMatrixDto,
  ) {
    return this.catalogService.generateVariantMatrix(tenant, user, productId, dto);
  }

  @Patch('variants/:variantId')
  @ApiOperation({ summary: 'Actualiza precios, SKU, atributos o umbral de alerta de una variante' })
  updateVariant(
    @CurrentTenant() tenant: ResolvedTenantContext,
    @CurrentUser() user: AuthenticatedUserContext,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body() dto: UpdateVariantDto,
  ) {
    return this.catalogService.updateVariant(tenant, user, variantId, dto);
  }

  @Patch('variants/:variantId/stock')
  @ApiOperation({
    summary: 'Ajusta el stock físico atómicamente (SET o DELTA) protegiendo el stock reservado',
  })
  adjustVariantStock(
    @CurrentTenant() tenant: ResolvedTenantContext,
    @CurrentUser() user: AuthenticatedUserContext,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body() dto: AdjustStockDto,
  ) {
    return this.catalogService.adjustVariantStock(tenant, user, variantId, dto);
  }

  @Delete('variants/:variantId')
  @ApiOperation({ summary: 'Elimina o archiva una variante de producto' })
  deleteVariant(
    @CurrentTenant() tenant: ResolvedTenantContext,
    @CurrentUser() user: AuthenticatedUserContext,
    @Param('variantId', ParseUUIDPipe) variantId: string,
  ) {
    return this.catalogService.deleteVariant(tenant, user, variantId);
  }

  @Get('inventory/low-stock')
  @ApiOperation({
    summary: 'Lista alertas de variantes con stock disponible menor o igual a su umbral mínimo',
  })
  getLowStockAlerts(
    @CurrentTenant() tenant: ResolvedTenantContext,
    @CurrentUser() user: AuthenticatedUserContext,
  ) {
    return this.catalogService.getLowStockAlerts(tenant, user);
  }

  // ---- Wholesale B2B Tiers ----

  @Put('products/:productId/wholesale-tiers')
  @UseGuards(PlanQuotaGuard)
  @RequirePlanFeature('allowWholesale')
  @ApiOperation({
    summary:
      'Configura/reemplaza la tabla de precios mayoristas escalonados por cantidad validando rangos',
  })
  replaceWholesaleTiers(
    @CurrentTenant() tenant: ResolvedTenantContext,
    @CurrentUser() user: AuthenticatedUserContext,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: ReplaceWholesaleTiersDto,
  ) {
    return this.catalogService.replaceWholesaleTiers(tenant, user, productId, dto);
  }
}
