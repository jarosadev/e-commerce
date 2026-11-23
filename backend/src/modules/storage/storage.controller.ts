import { Body, Controller, ForbiddenException, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { PlatformRole, TenantMemberRole } from '@prisma/client';
import { AuthenticatedUserContext, ResolvedTenantContext } from '../../common/cls/cls.types';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireTenant } from '../../common/decorators/require-tenant.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PrismaService } from '../../database/prisma.service';
import {
  PresignDownloadRequestDto,
  PresignDownloadResponseDto,
  PresignUploadRequestDto,
  PresignUploadResponseDto,
} from './dto/storage.dto';
import { StorageUploadScope } from './storage.constants';
import { StorageService } from './storage.service';

@ApiTags('Storage (S3 / R2 Presigned URLs)')
@ApiBearerAuth('access-token')
@ApiCookieAuth('access_token')
@RequireTenant()
@Controller('storage')
export class StorageController {
  constructor(
    private readonly storageService: StorageService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('presign-upload')
  @HttpCode(HttpStatus.CREATED)
  @Roles(PlatformRole.SUPER_ADMIN, PlatformRole.STORE_OWNER, PlatformRole.STORE_STAFF, 'CUSTOMER')
  @ApiOperation({
    summary:
      'Genera una Presigned PUT URL con validación MIME/tamaño (catálogo/branding públicos o comprobante privado)',
  })
  @ApiCreatedResponse({ type: PresignUploadResponseDto })
  async presignUpload(
    @CurrentTenant() tenant: ResolvedTenantContext,
    @CurrentUser() user: AuthenticatedUserContext,
    @Body() dto: PresignUploadRequestDto,
  ): Promise<PresignUploadResponseDto> {
    if (user.actorType === 'CUSTOMER') {
      if (dto.scope !== StorageUploadScope.RECEIPT) {
        throw new ForbiddenException(
          'Los compradores solo pueden subir archivos de comprobantes de pago.',
        );
      }
      if (user.tenantId && user.tenantId !== tenant.id) {
        throw new ForbiddenException('Tu sesión de comprador pertenece a otra tienda.');
      }
    } else {
      await this.assertPlatformTenantAccess(tenant, user);
    }

    return this.storageService.createPresignedUploadUrl(tenant.id, dto);
  }

  @Post('presign-download')
  @HttpCode(HttpStatus.OK)
  @Roles(PlatformRole.SUPER_ADMIN, PlatformRole.STORE_OWNER, PlatformRole.STORE_STAFF)
  @ApiOperation({
    summary:
      'Genera una Presigned GET URL temporal (5 min) para visualizar comprobantes privados de la tienda',
  })
  @ApiOkResponse({ type: PresignDownloadResponseDto })
  async presignDownload(
    @CurrentTenant() tenant: ResolvedTenantContext,
    @CurrentUser() user: AuthenticatedUserContext,
    @Body() dto: PresignDownloadRequestDto,
  ): Promise<PresignDownloadResponseDto> {
    await this.assertPlatformTenantAccess(tenant, user);
    return this.storageService.createPrivateReadUrl(tenant.id, dto.objectKey);
  }

  private async assertPlatformTenantAccess(
    tenant: ResolvedTenantContext,
    user: AuthenticatedUserContext,
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

    if (
      !membership ||
      ![TenantMemberRole.OWNER, TenantMemberRole.ADMIN, TenantMemberRole.STAFF].includes(
        membership.role,
      )
    ) {
      throw new ForbiddenException('No tienes permisos de almacenamiento sobre esta tienda.');
    }
  }
}
