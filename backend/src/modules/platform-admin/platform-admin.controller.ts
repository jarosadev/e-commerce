import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { PlatformRole } from '@prisma/client';
import { AuthenticatedUserContext } from '../../common/cls/cls.types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SkipTenantStatus } from '../../common/decorators/require-tenant.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { LifecycleRunResultDto } from '../subscriptions/dto/subscription.dto';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import {
  AppendClientNoteDto,
  CreateSubscriptionPaymentDto,
  ListClientsQueryDto,
  ListPaymentsQueryDto,
  ReviewSubscriptionPaymentDto,
  UpdateClientProfileDto,
  UpdateTenantStatusDto,
} from './dto/platform-admin.dto';
import { PlatformAdminService } from './platform-admin.service';

@ApiTags('Platform Admin - CRM')
@ApiBearerAuth('access-token')
@ApiCookieAuth('access_token')
@Roles(PlatformRole.SUPER_ADMIN)
@SkipTenantStatus()
@Controller('platform-admin')
export class PlatformAdminController {
  constructor(
    private readonly platformAdminService: PlatformAdminService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  @ApiOperation({ summary: 'Get platform overview & normalized SaaS MRR KPIs' })
  @ApiResponse({ status: 200, description: 'Overview data' })
  @Get('overview')
  getOverview() {
    return this.platformAdminService.getOverview();
  }

  @ApiOperation({ summary: 'List CRM store owners with search, tenantStatus and planCode filters' })
  @Get('clients')
  listClients(@Query() query: ListClientsQueryDto) {
    return this.platformAdminService.listClients(query);
  }

  @ApiOperation({ summary: 'Get full CRM client fiche including stores, quota usage and payments' })
  @Get('clients/:ownerId')
  getClientDetail(@Param('ownerId', ParseUUIDPipe) ownerId: string) {
    return this.platformAdminService.getClientDetail(ownerId);
  }

  @ApiOperation({ summary: 'Update CRM client fiscal/commercial profile and internal notes' })
  @Patch('clients/:ownerId')
  updateClientProfile(
    @Param('ownerId', ParseUUIDPipe) ownerId: string,
    @Body() dto: UpdateClientProfileDto,
  ) {
    return this.platformAdminService.updateClientProfile(ownerId, dto);
  }

  @ApiOperation({ summary: 'Append timestamped note to CRM client internal log' })
  @Post('clients/:ownerId/notes')
  @HttpCode(HttpStatus.OK)
  appendClientNote(
    @Param('ownerId', ParseUUIDPipe) ownerId: string,
    @CurrentUser() user: AuthenticatedUserContext,
    @Body() dto: AppendClientNoteDto,
  ) {
    return this.platformAdminService.appendClientNote(ownerId, user, dto.note);
  }

  @ApiOperation({
    summary: 'Update tenant operational status (TRIAL, ACTIVE, PAST_DUE, SUSPENDED)',
  })
  @Patch('tenants/:tenantId/status')
  updateTenantStatus(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() body: UpdateTenantStatusDto,
  ) {
    return this.platformAdminService.updateTenantStatus(tenantId, body.status);
  }

  @ApiOperation({
    summary: 'List SaaS subscription payments with reviewStatus and tenantId filters',
  })
  @Get('payments')
  listPayments(@Query() query: ListPaymentsQueryDto) {
    return this.platformAdminService.listPayments(query);
  }

  @ApiOperation({ summary: 'Register a manual SaaS subscription payment on behalf of a store' })
  @Post('payments')
  createPayment(@Body() dto: CreateSubscriptionPaymentDto) {
    return this.platformAdminService.createPayment(dto);
  }

  @ApiOperation({ summary: 'Approve or reject a pending SaaS subscription payment' })
  @Patch('payments/:paymentId/review')
  reviewPayment(
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @CurrentUser() user: AuthenticatedUserContext,
    @Body() body: ReviewSubscriptionPaymentDto,
  ) {
    return this.platformAdminService.reviewPayment(paymentId, user, body.reviewStatus, body.note);
  }

  @ApiOperation({
    summary:
      'Execute SaaS subscription lifecycle sweep (expiring reminders, PAST_DUE grace period, auto-suspension)',
  })
  @ApiOkResponse({ type: LifecycleRunResultDto })
  @Post('subscriptions/run-lifecycle-check')
  @HttpCode(HttpStatus.OK)
  runLifecycleCheck(): Promise<LifecycleRunResultDto> {
    return this.subscriptionsService.runSubscriptionLifecycleCheck();
  }
}
