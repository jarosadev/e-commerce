import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { PlatformRole } from '@prisma/client';
import { AuthenticatedUserContext, RequestWithContext } from '../../common/cls/cls.types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { SkipTenantStatus } from '../../common/decorators/require-tenant.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  CancelSubscriptionDto,
  ChangePlanDto,
  CheckoutSessionResponseDto,
  CreateCheckoutSessionDto,
  MercadoPagoWebhookPayloadDto,
  StripeWebhookPayloadDto,
  SubmitManualSubscriptionPaymentDto,
  SubscriptionPaymentItemDto,
  SubscriptionSummaryDto,
  WebhookAckDto,
} from './dto/subscription.dto';
import { SubscriptionsService } from './subscriptions.service';

@ApiTags('Subscriptions & SaaS Billing')
@SkipTenantStatus()
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Get('current')
  @Roles(PlatformRole.STORE_OWNER, PlatformRole.STORE_STAFF, PlatformRole.SUPER_ADMIN)
  @ApiBearerAuth('access-token')
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary: 'Obtiene suscripción actual, cuotas usadas, historial de pagos y planes disponibles',
  })
  @ApiOkResponse({ type: SubscriptionSummaryDto })
  getCurrentSubscription(
    @Req() req: RequestWithContext,
    @CurrentUser() user: AuthenticatedUserContext,
  ): Promise<SubscriptionSummaryDto> {
    return this.subscriptionsService.getCurrentSubscription(req, user);
  }

  @Post('change-plan')
  @HttpCode(HttpStatus.OK)
  @Roles(PlatformRole.STORE_OWNER, PlatformRole.SUPER_ADMIN)
  @ApiBearerAuth('access-token')
  @ApiCookieAuth('access-token')
  @ApiOperation({ summary: 'Cambia de plan SaaS o ciclo de facturación validando cuotas actuales' })
  @ApiOkResponse({ type: SubscriptionSummaryDto })
  changePlan(
    @Req() req: RequestWithContext,
    @CurrentUser() user: AuthenticatedUserContext,
    @Body() dto: ChangePlanDto,
  ): Promise<SubscriptionSummaryDto> {
    return this.subscriptionsService.changePlan(req, user, dto);
  }

  @Post('checkout/stripe')
  @HttpCode(HttpStatus.CREATED)
  @Roles(PlatformRole.STORE_OWNER, PlatformRole.SUPER_ADMIN)
  @ApiBearerAuth('access-token')
  @ApiCookieAuth('access-token')
  @ApiOperation({
    summary: 'Crea una sesión de Stripe Billing Checkout (modo live o sandbox local)',
  })
  @ApiCreatedResponse({ type: CheckoutSessionResponseDto })
  createStripeCheckout(
    @Req() req: RequestWithContext,
    @CurrentUser() user: AuthenticatedUserContext,
    @Body() dto: CreateCheckoutSessionDto,
  ): Promise<CheckoutSessionResponseDto> {
    return this.subscriptionsService.createStripeCheckoutSession(req, user, dto);
  }

  @Post('checkout/mercadopago')
  @HttpCode(HttpStatus.CREATED)
  @Roles(PlatformRole.STORE_OWNER, PlatformRole.SUPER_ADMIN)
  @ApiBearerAuth('access-token')
  @ApiCookieAuth('access-token')
  @ApiOperation({
    summary: 'Crea una suscripción recurrente en MercadoPago (modo live o sandbox local)',
  })
  @ApiCreatedResponse({ type: CheckoutSessionResponseDto })
  createMercadoPagoCheckout(
    @Req() req: RequestWithContext,
    @CurrentUser() user: AuthenticatedUserContext,
    @Body() dto: CreateCheckoutSessionDto,
  ): Promise<CheckoutSessionResponseDto> {
    return this.subscriptionsService.createMercadoPagoCheckoutSession(req, user, dto);
  }

  @Post('manual-payments')
  @HttpCode(HttpStatus.CREATED)
  @Roles(PlatformRole.STORE_OWNER, PlatformRole.SUPER_ADMIN)
  @ApiBearerAuth('access-token')
  @ApiCookieAuth('access-token')
  @ApiOperation({
    summary: 'Reporta un pago manual de suscripción por transferencia para validación SuperAdmin',
  })
  @ApiCreatedResponse({ type: SubscriptionPaymentItemDto })
  submitManualPayment(
    @Req() req: RequestWithContext,
    @CurrentUser() user: AuthenticatedUserContext,
    @Body() dto: SubmitManualSubscriptionPaymentDto,
  ): Promise<SubscriptionPaymentItemDto> {
    return this.subscriptionsService.submitManualPayment(req, user, dto);
  }

  @Post('cancel')
  @HttpCode(HttpStatus.OK)
  @Roles(PlatformRole.STORE_OWNER, PlatformRole.SUPER_ADMIN)
  @ApiBearerAuth('access-token')
  @ApiCookieAuth('access-token')
  @ApiOperation({ summary: 'Programa o revierte la cancelación al final del período actual' })
  @ApiOkResponse({ type: SubscriptionSummaryDto })
  toggleCancelAtPeriodEnd(
    @Req() req: RequestWithContext,
    @CurrentUser() user: AuthenticatedUserContext,
    @Body() dto: CancelSubscriptionDto,
  ): Promise<SubscriptionSummaryDto> {
    return this.subscriptionsService.toggleCancelAtPeriodEnd(req, user, dto);
  }

  @Post('webhooks/stripe')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Webhook idempotente de Stripe Billing (activación, fallo de pago y cancelación)',
  })
  @ApiOkResponse({ type: WebhookAckDto })
  handleStripeWebhook(
    @Body() payload: StripeWebhookPayloadDto,
    @Headers('stripe-signature') signature?: string,
  ): Promise<WebhookAckDto> {
    return this.subscriptionsService.handleStripeWebhook(payload, signature);
  }

  @Post('webhooks/mercadopago')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Webhook idempotente de MercadoPago Suscripciones',
  })
  @ApiOkResponse({ type: WebhookAckDto })
  handleMercadoPagoWebhook(
    @Body() payload: MercadoPagoWebhookPayloadDto,
    @Headers('x-signature') signature?: string,
  ): Promise<WebhookAckDto> {
    return this.subscriptionsService.handleMercadoPagoWebhook(payload, signature);
  }
}
