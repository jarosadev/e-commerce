import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { PlatformRole } from '@prisma/client';
import {
  AuthenticatedUserContext,
  RequestWithContext,
  ResolvedTenantContext,
} from '../../common/cls/cls.types';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequireTenant, SkipTenantStatus } from '../../common/decorators/require-tenant.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  CheckSlugQueryDto,
  CreateTenantDto,
  ResolveTenantQueryDto,
  SlugAvailabilityDto,
  StoreThemeDto,
  TenantDetailDto,
  UpdateStoreThemeDto,
  UpdateTenantSettingsDto,
} from './dto/tenant.dto';
import { TenantsService } from './tenants.service';

@ApiTags('Tenants')
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Get('resolve')
  @Public()
  @ApiOperation({
    summary: 'Resuelve información pública de tienda por x-tenant-host, x-tenant-slug o ?slug=',
  })
  @ApiOkResponse({ type: TenantDetailDto })
  resolveTenant(
    @Req() req: RequestWithContext,
    @Query() query: ResolveTenantQueryDto,
  ): Promise<TenantDetailDto> {
    return this.tenantsService.resolvePublicTenant(req, query.slug);
  }

  @Get('check-slug')
  @Public()
  @SkipTenantStatus()
  @ApiOperation({
    summary: 'Verifica disponibilidad en tiempo real de un subdominio para el onboarding',
  })
  @ApiOkResponse({ type: SlugAvailabilityDto })
  checkSlug(@Query() query: CheckSlugQueryDto): Promise<SlugAvailabilityDto> {
    return this.tenantsService.checkSlugAvailability(query.slug);
  }

  @Post()
  @SkipTenantStatus()
  @Roles(PlatformRole.STORE_OWNER, PlatformRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth('access-token')
  @ApiCookieAuth('access_token')
  @ApiOperation({ summary: 'Crea una nueva tienda en TRIAL con tema y suscripción de 14 días' })
  @ApiCreatedResponse({ type: TenantDetailDto })
  createTenant(
    @CurrentUser() user: AuthenticatedUserContext,
    @Body() dto: CreateTenantDto,
  ): Promise<TenantDetailDto> {
    return this.tenantsService.createTenant(user, dto);
  }

  @Get()
  @SkipTenantStatus()
  @Roles(PlatformRole.STORE_OWNER, PlatformRole.STORE_STAFF, PlatformRole.SUPER_ADMIN)
  @ApiBearerAuth('access-token')
  @ApiCookieAuth('access_token')
  @ApiOperation({ summary: 'Lista las tiendas del usuario autenticado' })
  @ApiOkResponse({ type: [TenantDetailDto] })
  listMyTenants(@CurrentUser() user: AuthenticatedUserContext): Promise<TenantDetailDto[]> {
    return this.tenantsService.listMyTenants(user);
  }

  @Get('current')
  @Roles(PlatformRole.STORE_OWNER, PlatformRole.STORE_STAFF, PlatformRole.SUPER_ADMIN)
  @ApiBearerAuth('access-token')
  @ApiCookieAuth('access_token')
  @ApiOperation({ summary: 'Retorna la tienda actual resuelta o la primera tienda del usuario' })
  @ApiOkResponse({ type: TenantDetailDto })
  getCurrentTenant(
    @Req() req: RequestWithContext,
    @CurrentUser() user: AuthenticatedUserContext,
  ): Promise<TenantDetailDto> {
    return this.tenantsService.getCurrentTenant(req, user);
  }

  @Patch('current/theme')
  @RequireTenant()
  @Roles(PlatformRole.STORE_OWNER, PlatformRole.STORE_STAFF, PlatformRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiCookieAuth('access_token')
  @ApiOperation({ summary: 'Actualiza el StoreTheme de la tienda actual e invalida caché Redis' })
  @ApiOkResponse({ type: StoreThemeDto })
  updateCurrentTheme(
    @CurrentTenant() tenant: ResolvedTenantContext,
    @CurrentUser() user: AuthenticatedUserContext,
    @Body() dto: UpdateStoreThemeDto,
  ): Promise<StoreThemeDto> {
    return this.tenantsService.updateCurrentTheme(tenant, user, dto);
  }

  @Patch('current/settings')
  @RequireTenant()
  @Roles(PlatformRole.STORE_OWNER, PlatformRole.STORE_STAFF, PlatformRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary:
      'Actualiza la configuración operativa y reglas B2B de la tienda (WhatsApp, moneda, mínimos mayoristas)',
  })
  @ApiOkResponse({ type: TenantDetailDto })
  updateCurrentSettings(
    @CurrentTenant() tenant: ResolvedTenantContext,
    @CurrentUser() user: AuthenticatedUserContext,
    @Body() dto: UpdateTenantSettingsDto,
  ): Promise<TenantDetailDto> {
    return this.tenantsService.updateCurrentSettings(tenant, user, dto);
  }
}
