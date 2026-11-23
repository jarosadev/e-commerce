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
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PlatformRole } from '@prisma/client';
import { AuthenticatedUserContext, ResolvedTenantContext } from '../../common/cls/cls.types';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireTenant } from '../../common/decorators/require-tenant.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  CreatePaymentMethodDto,
  CreateShippingZoneDto,
  ListStoreCustomersQueryDto,
  UpdatePaymentMethodDto,
  UpdateShippingZoneDto,
  UpdateStoreCustomerTierDto,
} from './dto/store-ops.dto';
import { StoreOpsService } from './store-ops.service';

@ApiTags('Store Operations (Payments, Shipping & B2B Customers)')
@ApiBearerAuth('access-token')
@ApiCookieAuth('access_token')
@RequireTenant()
@Roles(PlatformRole.SUPER_ADMIN, PlatformRole.STORE_OWNER, PlatformRole.STORE_STAFF)
@Controller('store-ops')
export class StoreOpsController {
  constructor(private readonly storeOpsService: StoreOpsService) {}

  // ---- Payment Methods ----

  @Get('payment-methods')
  @ApiOperation({ summary: 'Lista los métodos de pago manuales configurados por la tienda' })
  listPaymentMethods(
    @CurrentTenant() tenant: ResolvedTenantContext,
    @CurrentUser() user: AuthenticatedUserContext,
  ) {
    return this.storeOpsService.listPaymentMethods(tenant, user);
  }

  @Post('payment-methods')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Crea un método de pago manual (Transferencia, QR, Contraentrega, B2B)',
  })
  createPaymentMethod(
    @CurrentTenant() tenant: ResolvedTenantContext,
    @CurrentUser() user: AuthenticatedUserContext,
    @Body() dto: CreatePaymentMethodDto,
  ) {
    return this.storeOpsService.createPaymentMethod(tenant, user, dto);
  }

  @Patch('payment-methods/:methodId')
  @ApiOperation({ summary: 'Actualiza un método de pago manual de la tienda' })
  updatePaymentMethod(
    @CurrentTenant() tenant: ResolvedTenantContext,
    @CurrentUser() user: AuthenticatedUserContext,
    @Param('methodId', ParseUUIDPipe) methodId: string,
    @Body() dto: UpdatePaymentMethodDto,
  ) {
    return this.storeOpsService.updatePaymentMethod(tenant, user, methodId, dto);
  }

  @Delete('payment-methods/:methodId')
  @ApiOperation({ summary: 'Elimina un método de pago manual de la tienda' })
  deletePaymentMethod(
    @CurrentTenant() tenant: ResolvedTenantContext,
    @CurrentUser() user: AuthenticatedUserContext,
    @Param('methodId', ParseUUIDPipe) methodId: string,
  ) {
    return this.storeOpsService.deletePaymentMethod(tenant, user, methodId);
  }

  // ---- Shipping Zones ----

  @Get('shipping-zones')
  @ApiOperation({ summary: 'Lista zonas de envío, montos de envío gratis y sucursales de retiro' })
  listShippingZones(
    @CurrentTenant() tenant: ResolvedTenantContext,
    @CurrentUser() user: AuthenticatedUserContext,
  ) {
    return this.storeOpsService.listShippingZones(tenant, user);
  }

  @Post('shipping-zones')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crea una zona de envío o punto de retiro en local' })
  createShippingZone(
    @CurrentTenant() tenant: ResolvedTenantContext,
    @CurrentUser() user: AuthenticatedUserContext,
    @Body() dto: CreateShippingZoneDto,
  ) {
    return this.storeOpsService.createShippingZone(tenant, user, dto);
  }

  @Patch('shipping-zones/:zoneId')
  @ApiOperation({ summary: 'Actualiza una zona de envío o sucursal de retiro' })
  updateShippingZone(
    @CurrentTenant() tenant: ResolvedTenantContext,
    @CurrentUser() user: AuthenticatedUserContext,
    @Param('zoneId', ParseUUIDPipe) zoneId: string,
    @Body() dto: UpdateShippingZoneDto,
  ) {
    return this.storeOpsService.updateShippingZone(tenant, user, zoneId, dto);
  }

  @Delete('shipping-zones/:zoneId')
  @ApiOperation({ summary: 'Elimina una zona de envío de la tienda' })
  deleteShippingZone(
    @CurrentTenant() tenant: ResolvedTenantContext,
    @CurrentUser() user: AuthenticatedUserContext,
    @Param('zoneId', ParseUUIDPipe) zoneId: string,
  ) {
    return this.storeOpsService.deleteShippingZone(tenant, user, zoneId);
  }

  // ---- Store Customers CRM ----

  @Get('customers')
  @ApiOperation({
    summary: 'Lista los compradores registrados de la tienda con filtro RETAIL/WHOLESALE_B2B',
  })
  listStoreCustomers(
    @CurrentTenant() tenant: ResolvedTenantContext,
    @CurrentUser() user: AuthenticatedUserContext,
    @Query() query: ListStoreCustomersQueryDto,
  ) {
    return this.storeOpsService.listStoreCustomers(tenant, user, query);
  }

  @Patch('customers/:customerId/tier')
  @ApiOperation({ summary: 'Etiqueta o promueve un comprador entre RETAIL y WHOLESALE_B2B' })
  updateStoreCustomerTier(
    @CurrentTenant() tenant: ResolvedTenantContext,
    @CurrentUser() user: AuthenticatedUserContext,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Body() dto: UpdateStoreCustomerTierDto,
  ) {
    return this.storeOpsService.updateStoreCustomerTier(tenant, user, customerId, dto);
  }
}
