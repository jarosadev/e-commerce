import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { PlatformRole, TenantStatus, PaymentReviewStatus } from '@prisma/client';
import { SkipTenantStatus } from '../../common/decorators/require-tenant.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PlatformAdminService } from './platform-admin.service';
import {
  ListClientsQueryDto,
  UpdateClientProfileDto,
  CreateSubscriptionPaymentDto,
  ListPaymentsQueryDto,
} from './dto/platform-admin.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUserContext } from '../../common/cls/cls.types';

@ApiTags('Platform Admin - CRM')
@ApiBearerAuth('access-token')
@ApiCookieAuth('access_token')
@Roles(PlatformRole.SUPER_ADMIN)
@SkipTenantStatus()
@Controller('platform-admin')
export class PlatformAdminController {
  constructor(private readonly platformAdminService: PlatformAdminService) {}

  @ApiOperation({ summary: 'Get platform overview' })
  @ApiResponse({ status: 200, description: 'Overview data' })
  @Get('overview')
  getOverview() {
    return this.platformAdminService.getOverview();
  }

  @Get('clients')
  listClients(@Query() query: ListClientsQueryDto) {
    return this.platformAdminService.listClients(query);
  }

  @Get('clients/:ownerId')
  getClientDetail(@Param('ownerId', ParseUUIDPipe) ownerId: string) {
    return this.platformAdminService.getClientDetail(ownerId);
  }

  @Patch('clients/:ownerId')
  updateClientProfile(
    @Param('ownerId', ParseUUIDPipe) ownerId: string,
    @Body() dto: UpdateClientProfileDto,
  ) {
    return this.platformAdminService.updateClientProfile(ownerId, dto);
  }

  @Patch('tenants/:tenantId/status')
  updateTenantStatus(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() body: { status: TenantStatus },
  ) {
    return this.platformAdminService.updateTenantStatus(tenantId, body.status);
  }

  @Get('payments')
  listPayments(@Query() query: ListPaymentsQueryDto) {
    return this.platformAdminService.listPayments(query);
  }

  @Post('payments')
  createPayment(@Body() dto: CreateSubscriptionPaymentDto) {
    return this.platformAdminService.createPayment(dto);
  }

  @Patch('payments/:paymentId/review')
  reviewPayment(
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @CurrentUser() user: AuthenticatedUserContext,
    @Body() body: { reviewStatus: PaymentReviewStatus; note?: string },
  ) {
    return this.platformAdminService.reviewPayment(paymentId, user, body.reviewStatus, body.note);
  }
}
