import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BillingCycle,
  PaymentReviewStatus,
  Plan,
  PlatformRole,
  Subscription,
  SubscriptionPayment,
  SubscriptionPaymentProvider,
  SubscriptionStatus,
  Tenant,
  TenantMemberRole,
  TenantStatus,
} from '@prisma/client';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { AuthenticatedUserContext, RequestWithContext } from '../../common/cls/cls.types';
import { TenantResolutionService } from '../../common/services/tenant-resolution.service';
import { EnvConfig } from '../../config/env.validation';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.module';
import { NotificationsService } from '../notifications/notifications.service';
import {
  CancelSubscriptionDto,
  ChangePlanDto,
  CheckoutSessionResponseDto,
  CreateCheckoutSessionDto,
  LifecycleRunResultDto,
  MercadoPagoWebhookPayloadDto,
  StripeWebhookPayloadDto,
  SubmitManualSubscriptionPaymentDto,
  SubscriptionPaymentItemDto,
  SubscriptionSummaryDto,
  WebhookAckDto,
} from './dto/subscription.dto';
import {
  REMINDER_DEDUPE_TTL_SECONDS,
  WEBHOOK_IDEMPOTENCY_TTL_SECONDS,
} from './subscriptions.constants';

type TenantForBilling = Tenant & {
  customDomains: Array<{ hostname: string }>;
  owner: { id: string; email: string; fullName: string };
  subscription: (Subscription & { plan: Plan; payments: SubscriptionPayment[] }) | null;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService<EnvConfig, true>,
    private readonly tenantResolutionService: TenantResolutionService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async getCurrentSubscription(
    req: RequestWithContext,
    user: AuthenticatedUserContext,
  ): Promise<SubscriptionSummaryDto> {
    const tenant = await this.resolveOwnerTenant(req, user, [
      TenantMemberRole.OWNER,
      TenantMemberRole.ADMIN,
      TenantMemberRole.STAFF,
    ]);

    if (!tenant.subscription) {
      throw new NotFoundException('La tienda no posee una suscripción configurada.');
    }

    const [productsUsed, staffUsed, availablePlans] = await Promise.all([
      this.prisma.product.count({ where: { tenantId: tenant.id, isActive: true } }),
      this.prisma.tenantMember.count({ where: { tenantId: tenant.id } }),
      this.prisma.plan.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { priceMonthly: 'asc' }],
      }),
    ]);

    const sub = tenant.subscription;
    const now = Date.now();
    const daysUntilPeriodEnd = Math.max(
      0,
      Math.ceil((sub.currentPeriodEnd.getTime() - now) / MS_PER_DAY),
    );
    const isInGracePeriod =
      sub.status === SubscriptionStatus.PAST_DUE &&
      sub.gracePeriodEndsAt !== null &&
      sub.gracePeriodEndsAt.getTime() > now;
    const graceDaysRemaining =
      isInGracePeriod && sub.gracePeriodEndsAt
        ? Math.max(0, Math.ceil((sub.gracePeriodEndsAt.getTime() - now) / MS_PER_DAY))
        : 0;

    return {
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      tenantName: tenant.name,
      tenantStatus: tenant.status,
      subscriptionId: sub.id,
      status: sub.status,
      billingCycle: sub.billingCycle,
      currentPeriodStart: sub.currentPeriodStart.toISOString(),
      currentPeriodEnd: sub.currentPeriodEnd.toISOString(),
      gracePeriodEndsAt: sub.gracePeriodEndsAt ? sub.gracePeriodEndsAt.toISOString() : null,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      daysUntilPeriodEnd,
      isInGracePeriod,
      graceDaysRemaining,
      plan: this.serializePlan(sub.plan),
      usage: {
        productsUsed,
        maxProducts: sub.plan.maxProducts,
        productsUsagePercent:
          sub.plan.maxProducts > 0
            ? Math.min(100, Math.round((productsUsed / sub.plan.maxProducts) * 100))
            : 0,
        staffUsed,
        maxStaff: sub.plan.maxStaff,
        staffUsagePercent:
          sub.plan.maxStaff > 0
            ? Math.min(100, Math.round((staffUsed / sub.plan.maxStaff) * 100))
            : 0,
      },
      payments: sub.payments.map((p) => this.serializePayment(p)),
      availablePlans: availablePlans.map((plan) => this.serializePlan(plan)),
    };
  }

  async changePlan(
    req: RequestWithContext,
    user: AuthenticatedUserContext,
    dto: ChangePlanDto,
  ): Promise<SubscriptionSummaryDto> {
    if (!dto.planCode && !dto.planId) {
      throw new BadRequestException('Debes indicar planCode o planId para cambiar de plan.');
    }

    const tenant = await this.resolveOwnerTenant(req, user, [
      TenantMemberRole.OWNER,
      TenantMemberRole.ADMIN,
    ]);

    if (!tenant.subscription) {
      throw new NotFoundException('La tienda no posee una suscripción configurada.');
    }

    const targetPlan = dto.planId
      ? await this.prisma.plan.findFirst({ where: { id: dto.planId, isActive: true } })
      : await this.prisma.plan.findFirst({
          where: { code: dto.planCode!.trim().toUpperCase(), isActive: true },
        });

    if (!targetPlan) {
      throw new NotFoundException('El plan solicitado no existe o no está activo.');
    }

    const [productsUsed, staffUsed] = await Promise.all([
      this.prisma.product.count({ where: { tenantId: tenant.id, isActive: true } }),
      this.prisma.tenantMember.count({ where: { tenantId: tenant.id } }),
    ]);

    if (productsUsed > targetPlan.maxProducts) {
      throw new ConflictException({
        code: 'DOWNGRADE_QUOTA_EXCEEDED',
        message: `Tu tienda tiene ${productsUsed} productos activos y el plan ${targetPlan.name} permite máximo ${targetPlan.maxProducts}.`,
      });
    }

    if (staffUsed > targetPlan.maxStaff) {
      throw new ConflictException({
        code: 'DOWNGRADE_QUOTA_EXCEEDED',
        message: `Tu tienda tiene ${staffUsed} usuarios de equipo y el plan ${targetPlan.name} permite máximo ${targetPlan.maxStaff}.`,
      });
    }

    await this.prisma.subscription.update({
      where: { id: tenant.subscription.id },
      data: {
        planId: targetPlan.id,
        ...(dto.billingCycle ? { billingCycle: dto.billingCycle } : {}),
      },
    });

    await this.tenantResolutionService.invalidateTenantCache(
      tenant.slug,
      tenant.customDomains.map((d) => d.hostname),
    );

    return this.getCurrentSubscription(req, user);
  }

  async createStripeCheckoutSession(
    req: RequestWithContext,
    user: AuthenticatedUserContext,
    dto: CreateCheckoutSessionDto,
  ): Promise<CheckoutSessionResponseDto> {
    const { tenant, plan, billingCycle, amount } = await this.prepareCheckoutContext(
      req,
      user,
      dto,
    );

    const stripeKey = this.config.get('STRIPE_SECRET_KEY', { infer: true }).trim();
    const frontendUrl = this.config.get('FRONTEND_URL', { infer: true });
    const successUrl = dto.successUrl ?? `${frontendUrl}/dashboard?billing=success&provider=stripe`;
    const cancelUrl = dto.cancelUrl ?? `${frontendUrl}/dashboard?billing=cancelled&provider=stripe`;

    if (stripeKey && !stripeKey.toLowerCase().includes('placeholder')) {
      const formBody = new URLSearchParams({
        mode: 'subscription',
        success_url: successUrl,
        cancel_url: cancelUrl,
        'line_items[0][price_data][currency]': plan.currency.toLowerCase(),
        'line_items[0][price_data][product_data][name]': `${plan.name} (${tenant.name})`,
        'line_items[0][price_data][unit_amount]': String(Math.round(amount * 100)),
        'line_items[0][price_data][recurring][interval]':
          billingCycle === BillingCycle.YEARLY ? 'year' : 'month',
        'line_items[0][quantity]': '1',
        'metadata[tenantId]': tenant.id,
        'metadata[subscriptionId]': tenant.subscription!.id,
        'metadata[planCode]': plan.code,
        'metadata[billingCycle]': billingCycle,
      });

      const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${stripeKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formBody.toString(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`Stripe Checkout error (${response.status}): ${errorText}`);
        throw new BadRequestException('No se pudo iniciar la sesión de pago con Stripe.');
      }

      const data = (await response.json()) as { id: string; url: string };
      return {
        provider: 'STRIPE',
        mode: 'live',
        sessionId: data.id,
        checkoutUrl: data.url,
        amount,
        currency: plan.currency,
        planCode: plan.code,
        billingCycle,
      };
    }

    const sandboxSessionId = `cs_sandbox_${randomUUID().replace(/-/g, '').slice(0, 18)}`;
    return {
      provider: 'STRIPE',
      mode: 'sandbox',
      sessionId: sandboxSessionId,
      checkoutUrl: `${successUrl}&session_id=${sandboxSessionId}&sandbox=true`,
      amount,
      currency: plan.currency,
      planCode: plan.code,
      billingCycle,
    };
  }

  async createMercadoPagoCheckoutSession(
    req: RequestWithContext,
    user: AuthenticatedUserContext,
    dto: CreateCheckoutSessionDto,
  ): Promise<CheckoutSessionResponseDto> {
    const { tenant, plan, billingCycle, amount } = await this.prepareCheckoutContext(
      req,
      user,
      dto,
    );

    const mpToken = this.config.get('MERCADOPAGO_ACCESS_TOKEN', { infer: true }).trim();
    const frontendUrl = this.config.get('FRONTEND_URL', { infer: true });
    const successUrl =
      dto.successUrl ?? `${frontendUrl}/dashboard?billing=success&provider=mercadopago`;

    if (mpToken && !mpToken.toLowerCase().includes('placeholder')) {
      const response = await fetch('https://api.mercadopago.com/preapproval', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${mpToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reason: `${plan.name} - ${tenant.name}`,
          external_reference: tenant.id,
          payer_email: tenant.contactEmail ?? tenant.owner.email,
          back_url: successUrl,
          auto_recurring: {
            frequency: billingCycle === BillingCycle.YEARLY ? 12 : 1,
            frequency_type: 'months',
            transaction_amount: amount,
            currency_id: plan.currency,
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`MercadoPago Preapproval error (${response.status}): ${errorText}`);
        throw new BadRequestException('No se pudo iniciar la suscripción con MercadoPago.');
      }

      const data = (await response.json()) as { id: string; init_point: string };
      return {
        provider: 'MERCADOPAGO',
        mode: 'live',
        sessionId: data.id,
        checkoutUrl: data.init_point,
        amount,
        currency: plan.currency,
        planCode: plan.code,
        billingCycle,
      };
    }

    const sandboxSessionId = `mp_sandbox_${randomUUID().replace(/-/g, '').slice(0, 18)}`;
    return {
      provider: 'MERCADOPAGO',
      mode: 'sandbox',
      sessionId: sandboxSessionId,
      checkoutUrl: `${successUrl}&preapproval_id=${sandboxSessionId}&sandbox=true`,
      amount,
      currency: plan.currency,
      planCode: plan.code,
      billingCycle,
    };
  }

  async submitManualPayment(
    req: RequestWithContext,
    user: AuthenticatedUserContext,
    dto: SubmitManualSubscriptionPaymentDto,
  ): Promise<SubscriptionPaymentItemDto> {
    const tenant = await this.resolveOwnerTenant(req, user, [
      TenantMemberRole.OWNER,
      TenantMemberRole.ADMIN,
    ]);

    if (!tenant.subscription) {
      throw new NotFoundException('La tienda no posee una suscripción configurada.');
    }

    const normalizedRef = dto.externalReference.trim();
    const existingPending = await this.prisma.subscriptionPayment.findFirst({
      where: {
        subscriptionId: tenant.subscription.id,
        externalReference: normalizedRef,
        reviewStatus: PaymentReviewStatus.PENDING,
      },
    });

    if (existingPending) {
      throw new ConflictException(
        'Ya existe un comprobante pendiente con esa misma referencia de transferencia.',
      );
    }

    if (dto.targetPlanCode) {
      const targetPlan = await this.prisma.plan.findFirst({
        where: { code: dto.targetPlanCode.trim().toUpperCase(), isActive: true },
      });
      if (!targetPlan) {
        throw new BadRequestException('El plan destino indicado no existe o no está activo.');
      }
      await this.prisma.subscription.update({
        where: { id: tenant.subscription.id },
        data: {
          planId: targetPlan.id,
          ...(dto.billingCycle ? { billingCycle: dto.billingCycle } : {}),
        },
      });
    } else if (dto.billingCycle) {
      await this.prisma.subscription.update({
        where: { id: tenant.subscription.id },
        data: { billingCycle: dto.billingCycle },
      });
    }

    const created = await this.prisma.subscriptionPayment.create({
      data: {
        subscriptionId: tenant.subscription.id,
        provider: SubscriptionPaymentProvider.MANUAL_TRANSFER,
        amount: dto.amount,
        currency: (dto.currency ?? tenant.subscription.plan.currency ?? 'USD').toUpperCase(),
        externalReference: normalizedRef,
        receiptFileKey: dto.receiptFileKey?.trim() || null,
        reviewStatus: PaymentReviewStatus.PENDING,
      },
    });

    return this.serializePayment(created);
  }

  async toggleCancelAtPeriodEnd(
    req: RequestWithContext,
    user: AuthenticatedUserContext,
    dto: CancelSubscriptionDto,
  ): Promise<SubscriptionSummaryDto> {
    const tenant = await this.resolveOwnerTenant(req, user, [
      TenantMemberRole.OWNER,
      TenantMemberRole.ADMIN,
    ]);

    if (!tenant.subscription) {
      throw new NotFoundException('La tienda no posee una suscripción configurada.');
    }

    await this.prisma.subscription.update({
      where: { id: tenant.subscription.id },
      data: { cancelAtPeriodEnd: dto.cancelAtPeriodEnd },
    });

    return this.getCurrentSubscription(req, user);
  }

  async handleStripeWebhook(
    payload: StripeWebhookPayloadDto,
    signatureHeader?: string,
  ): Promise<WebhookAckDto> {
    const secret = this.config.get('STRIPE_WEBHOOK_SECRET', { infer: true }).trim();
    if (secret) {
      this.verifyStripeSignature(payload, signatureHeader, secret);
    }

    const eventKey = `webhook:stripe:${payload.id}`;
    const externalRef = `stripe:${payload.id}`;
    const isFresh = await this.claimWebhookEvent(eventKey, externalRef);
    if (!isFresh) {
      return {
        received: true,
        duplicate: true,
        provider: 'STRIPE',
        eventId: payload.id,
        actionTaken: 'ignored_duplicate',
      };
    }

    const obj = payload.data?.object ?? {};
    const metadata = (obj.metadata as Record<string, unknown> | undefined) ?? {};
    const tenantId = typeof metadata.tenantId === 'string' ? metadata.tenantId : undefined;
    const subscriptionId =
      typeof metadata.subscriptionId === 'string' ? metadata.subscriptionId : undefined;
    const externalSubscriptionId =
      typeof obj.subscription === 'string'
        ? obj.subscription
        : typeof obj.id === 'string' && payload.type.startsWith('customer.subscription')
          ? obj.id
          : undefined;

    const subscription = await this.findSubscriptionForWebhook({
      tenantId,
      subscriptionId,
      externalSubscriptionId,
    });

    if (!subscription) {
      this.logger.warn(`Stripe webhook ${payload.id} sin suscripción coincidente.`);
      return {
        received: true,
        duplicate: false,
        provider: 'STRIPE',
        eventId: payload.id,
        actionTaken: 'subscription_not_found',
      };
    }

    if (
      payload.type === 'invoice.payment_succeeded' ||
      payload.type === 'checkout.session.completed'
    ) {
      const rawAmountCents =
        typeof obj.amount_paid === 'number'
          ? obj.amount_paid
          : typeof obj.amount_total === 'number'
            ? obj.amount_total
            : Number(subscription.plan.priceMonthly) * 100;
      const amount = Number((rawAmountCents / 100).toFixed(2));
      const currency =
        typeof obj.currency === 'string' ? obj.currency.toUpperCase() : subscription.plan.currency;
      const billingCycle =
        metadata.billingCycle === BillingCycle.YEARLY
          ? BillingCycle.YEARLY
          : metadata.billingCycle === BillingCycle.MONTHLY
            ? BillingCycle.MONTHLY
            : subscription.billingCycle;

      await this.activateSubscriptionFromGateway({
        subscription,
        provider: SubscriptionPaymentProvider.STRIPE,
        amount,
        currency,
        externalReference: externalRef,
        externalSubscriptionId,
        billingCycle,
      });

      return {
        received: true,
        duplicate: false,
        provider: 'STRIPE',
        eventId: payload.id,
        actionTaken: 'subscription_activated',
      };
    }

    if (payload.type === 'invoice.payment_failed') {
      await this.markSubscriptionPastDue(subscription);
      return {
        received: true,
        duplicate: false,
        provider: 'STRIPE',
        eventId: payload.id,
        actionTaken: 'moved_to_grace_period',
      };
    }

    if (payload.type === 'customer.subscription.deleted') {
      await this.suspendSubscription(subscription, SubscriptionStatus.CANCELED);
      return {
        received: true,
        duplicate: false,
        provider: 'STRIPE',
        eventId: payload.id,
        actionTaken: 'subscription_canceled_and_suspended',
      };
    }

    return {
      received: true,
      duplicate: false,
      provider: 'STRIPE',
      eventId: payload.id,
      actionTaken: 'ignored_event_type',
    };
  }

  async handleMercadoPagoWebhook(
    payload: MercadoPagoWebhookPayloadDto,
    signatureHeader?: string,
  ): Promise<WebhookAckDto> {
    const secret = this.config.get('MERCADOPAGO_WEBHOOK_SECRET', { infer: true }).trim();
    if (secret) {
      this.verifyHmacSignature(JSON.stringify(payload), signatureHeader, secret);
    }

    const eventKey = `webhook:mercadopago:${payload.id}`;
    const externalRef = `mp:${payload.id}`;
    const isFresh = await this.claimWebhookEvent(eventKey, externalRef);
    if (!isFresh) {
      return {
        received: true,
        duplicate: true,
        provider: 'MERCADOPAGO',
        eventId: payload.id,
        actionTaken: 'ignored_duplicate',
      };
    }

    const data = payload.data ?? {};
    const tenantId =
      typeof data.tenantId === 'string'
        ? data.tenantId
        : typeof data.external_reference === 'string'
          ? data.external_reference
          : undefined;
    const subscriptionId =
      typeof data.subscriptionId === 'string' ? data.subscriptionId : undefined;
    const externalSubscriptionId =
      typeof data.externalSubscriptionId === 'string'
        ? data.externalSubscriptionId
        : typeof data.preapproval_id === 'string'
          ? data.preapproval_id
          : undefined;

    const subscription = await this.findSubscriptionForWebhook({
      tenantId,
      subscriptionId,
      externalSubscriptionId,
    });

    if (!subscription) {
      this.logger.warn(`MercadoPago webhook ${payload.id} sin suscripción coincidente.`);
      return {
        received: true,
        duplicate: false,
        provider: 'MERCADOPAGO',
        eventId: payload.id,
        actionTaken: 'subscription_not_found',
      };
    }

    if (
      payload.action === 'payment.approved' ||
      payload.action === 'subscription_authorized_payment'
    ) {
      const amount =
        typeof data.amount === 'number' && data.amount > 0
          ? data.amount
          : Number(subscription.plan.priceMonthly);
      const currency =
        typeof data.currency === 'string'
          ? data.currency.toUpperCase()
          : subscription.plan.currency;
      const billingCycle =
        data.billingCycle === BillingCycle.YEARLY
          ? BillingCycle.YEARLY
          : data.billingCycle === BillingCycle.MONTHLY
            ? BillingCycle.MONTHLY
            : subscription.billingCycle;

      await this.activateSubscriptionFromGateway({
        subscription,
        provider: SubscriptionPaymentProvider.MERCADOPAGO,
        amount,
        currency,
        externalReference: externalRef,
        externalSubscriptionId,
        billingCycle,
      });

      return {
        received: true,
        duplicate: false,
        provider: 'MERCADOPAGO',
        eventId: payload.id,
        actionTaken: 'subscription_activated',
      };
    }

    if (payload.action === 'payment.rejected') {
      await this.markSubscriptionPastDue(subscription);
      return {
        received: true,
        duplicate: false,
        provider: 'MERCADOPAGO',
        eventId: payload.id,
        actionTaken: 'moved_to_grace_period',
      };
    }

    if (payload.action === 'subscription_cancelled') {
      await this.suspendSubscription(subscription, SubscriptionStatus.CANCELED);
      return {
        received: true,
        duplicate: false,
        provider: 'MERCADOPAGO',
        eventId: payload.id,
        actionTaken: 'subscription_canceled_and_suspended',
      };
    }

    return {
      received: true,
      duplicate: false,
      provider: 'MERCADOPAGO',
      eventId: payload.id,
      actionTaken: 'ignored_event_type',
    };
  }

  async runSubscriptionLifecycleCheck(now: Date = new Date()): Promise<LifecycleRunResultDto> {
    const reminderDays = this.config.get('SUBSCRIPTION_REMINDER_DAYS', { infer: true });
    const graceDays = this.config.get('SUBSCRIPTION_GRACE_DAYS', { infer: true });
    const frontendUrl = this.config.get('FRONTEND_URL', { infer: true });
    const billingUrl = `${frontendUrl}/dashboard`;

    const reminderCutoff = new Date(now.getTime() + reminderDays * MS_PER_DAY);

    let remindedCount = 0;
    let movedToGraceCount = 0;
    let suspendedCount = 0;
    let canceledAtPeriodEndCount = 0;

    // 1. Avisos preventivos antes del vencimiento
    const expiringSoon = await this.prisma.subscription.findMany({
      where: {
        status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING] },
        cancelAtPeriodEnd: false,
        currentPeriodEnd: {
          gt: now,
          lte: reminderCutoff,
        },
      },
      include: {
        plan: true,
        tenant: {
          include: {
            owner: { select: { id: true, email: true, fullName: true } },
            customDomains: { select: { hostname: true } },
          },
        },
      },
    });

    for (const sub of expiringSoon) {
      const dedupeKey = `billing:reminder:${sub.id}:${sub.currentPeriodEnd.toISOString().slice(0, 10)}`;
      const setResult = await this.redis.client.set(
        dedupeKey,
        '1',
        'EX',
        REMINDER_DEDUPE_TTL_SECONDS,
        'NX',
      );
      if (setResult !== 'OK') {
        continue;
      }

      const recipientEmail = sub.tenant.contactEmail || sub.tenant.owner.email;
      const daysRemaining = Math.max(
        1,
        Math.ceil((sub.currentPeriodEnd.getTime() - now.getTime()) / MS_PER_DAY),
      );
      await this.notificationsService.sendSubscriptionExpiringSoon({
        to: recipientEmail,
        ownerName: sub.tenant.owner.fullName,
        storeName: sub.tenant.name,
        planName: sub.plan.name,
        expiresAt: sub.currentPeriodEnd.toISOString().slice(0, 10),
        daysRemaining,
        billingUrl,
      });
      remindedCount++;
    }

    // 2. Suscripciones vencidas -> Período de gracia (PAST_DUE) o cancelación programada
    const expiredActive = await this.prisma.subscription.findMany({
      where: {
        status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING] },
        currentPeriodEnd: { lte: now },
      },
      include: {
        plan: true,
        tenant: {
          include: {
            owner: { select: { id: true, email: true, fullName: true } },
            customDomains: { select: { hostname: true } },
          },
        },
      },
    });

    for (const sub of expiredActive) {
      if (sub.cancelAtPeriodEnd) {
        await this.suspendSubscription(sub, SubscriptionStatus.CANCELED);
        canceledAtPeriodEndCount++;
      } else {
        await this.markSubscriptionPastDue(sub, now, graceDays);
        movedToGraceCount++;
      }
    }

    // 3. Períodos de gracia vencidos -> Suspensión automática (SUSPENDED)
    const expiredGrace = await this.prisma.subscription.findMany({
      where: {
        status: SubscriptionStatus.PAST_DUE,
        gracePeriodEndsAt: { lte: now },
      },
      include: {
        plan: true,
        tenant: {
          include: {
            owner: { select: { id: true, email: true, fullName: true } },
            customDomains: { select: { hostname: true } },
          },
        },
      },
    });

    for (const sub of expiredGrace) {
      await this.suspendSubscription(sub, SubscriptionStatus.SUSPENDED);
      suspendedCount++;
    }

    this.logger.log(
      `Lifecycle check: reminded=${remindedCount}, grace=${movedToGraceCount}, suspended=${suspendedCount}, canceled=${canceledAtPeriodEndCount}`,
    );

    return {
      remindedCount,
      movedToGraceCount,
      suspendedCount,
      canceledAtPeriodEndCount,
      executedAt: now.toISOString(),
    };
  }

  private async prepareCheckoutContext(
    req: RequestWithContext,
    user: AuthenticatedUserContext,
    dto: CreateCheckoutSessionDto,
  ) {
    const tenant = await this.resolveOwnerTenant(req, user, [
      TenantMemberRole.OWNER,
      TenantMemberRole.ADMIN,
    ]);

    if (!tenant.subscription) {
      throw new NotFoundException('La tienda no posee una suscripción configurada.');
    }

    const plan = dto.planCode
      ? await this.prisma.plan.findFirst({
          where: { code: dto.planCode.trim().toUpperCase(), isActive: true },
        })
      : tenant.subscription.plan;

    if (!plan) {
      throw new NotFoundException('El plan seleccionado no existe o no está activo.');
    }

    const billingCycle = dto.billingCycle ?? tenant.subscription.billingCycle;
    const amount = Number(
      billingCycle === BillingCycle.YEARLY ? plan.priceYearly : plan.priceMonthly,
    );

    return { tenant, plan, billingCycle, amount };
  }

  private async resolveOwnerTenant(
    req: RequestWithContext,
    user: AuthenticatedUserContext,
    allowedRoles: TenantMemberRole[],
  ): Promise<TenantForBilling> {
    const tenant: TenantForBilling | null = req.tenant
      ? await this.prisma.tenant.findUnique({
          where: { id: req.tenant.id },
          include: {
            customDomains: { select: { hostname: true } },
            owner: { select: { id: true, email: true, fullName: true } },
            subscription: {
              include: {
                plan: true,
                payments: { orderBy: { createdAt: 'desc' }, take: 25 },
              },
            },
          },
        })
      : await this.prisma.tenant.findFirst({
          where:
            user.role === PlatformRole.SUPER_ADMIN
              ? undefined
              : {
                  OR: [{ ownerId: user.sub }, { members: { some: { userId: user.sub } } }],
                },
          include: {
            customDomains: { select: { hostname: true } },
            owner: { select: { id: true, email: true, fullName: true } },
            subscription: {
              include: {
                plan: true,
                payments: { orderBy: { createdAt: 'desc' }, take: 25 },
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        });

    if (!tenant) {
      throw new NotFoundException('No se encontró una tienda asociada para gestionar suscripción.');
    }

    if (user.role !== PlatformRole.SUPER_ADMIN && tenant.ownerId !== user.sub) {
      const membership = await this.prisma.tenantMember.findUnique({
        where: {
          tenantId_userId: {
            tenantId: tenant.id,
            userId: user.sub,
          },
        },
      });
      if (!membership || !allowedRoles.includes(membership.role)) {
        throw new ForbiddenException('No tienes permisos sobre la facturación de esta tienda.');
      }
    }

    return tenant;
  }

  private async findSubscriptionForWebhook(lookup: {
    tenantId?: string;
    subscriptionId?: string;
    externalSubscriptionId?: string;
  }) {
    const include = {
      plan: true,
      tenant: {
        include: {
          owner: { select: { id: true, email: true, fullName: true } },
          customDomains: { select: { hostname: true } },
        },
      },
    };

    if (lookup.subscriptionId) {
      return this.prisma.subscription.findUnique({
        where: { id: lookup.subscriptionId },
        include,
      });
    }
    if (lookup.tenantId) {
      return this.prisma.subscription.findUnique({
        where: { tenantId: lookup.tenantId },
        include,
      });
    }
    if (lookup.externalSubscriptionId) {
      return this.prisma.subscription.findFirst({
        where: { externalSubscriptionId: lookup.externalSubscriptionId },
        include,
      });
    }
    return null;
  }

  private async claimWebhookEvent(redisKey: string, externalReference: string): Promise<boolean> {
    const existingPayment = await this.prisma.subscriptionPayment.findFirst({
      where: { externalReference },
      select: { id: true },
    });
    if (existingPayment) {
      return false;
    }

    const acquired = await this.redis.client.set(
      redisKey,
      '1',
      'EX',
      WEBHOOK_IDEMPOTENCY_TTL_SECONDS,
      'NX',
    );
    return acquired === 'OK';
  }

  private async activateSubscriptionFromGateway(params: {
    subscription: Subscription & {
      plan: Plan;
      tenant: Tenant & {
        owner: { id: string; email: string; fullName: string };
        customDomains: Array<{ hostname: string }>;
      };
    };
    provider: SubscriptionPaymentProvider;
    amount: number;
    currency: string;
    externalReference: string;
    externalSubscriptionId?: string;
    billingCycle: BillingCycle;
  }) {
    const now = new Date();
    const nextEnd = new Date(now);
    nextEnd.setMonth(nextEnd.getMonth() + (params.billingCycle === BillingCycle.YEARLY ? 12 : 1));

    await this.prisma.$transaction(async (tx) => {
      await tx.subscriptionPayment.create({
        data: {
          subscriptionId: params.subscription.id,
          provider: params.provider,
          amount: params.amount,
          currency: params.currency,
          externalReference: params.externalReference,
          reviewStatus: PaymentReviewStatus.APPROVED,
          paidAt: now,
        },
      });

      await tx.subscription.update({
        where: { id: params.subscription.id },
        data: {
          status: SubscriptionStatus.ACTIVE,
          billingCycle: params.billingCycle,
          currentPeriodStart: now,
          currentPeriodEnd: nextEnd,
          gracePeriodEndsAt: null,
          cancelAtPeriodEnd: false,
          ...(params.externalSubscriptionId
            ? { externalSubscriptionId: params.externalSubscriptionId }
            : {}),
        },
      });

      await tx.tenant.update({
        where: { id: params.subscription.tenantId },
        data: { status: TenantStatus.ACTIVE },
      });
    });

    await this.tenantResolutionService.invalidateTenantCache(
      params.subscription.tenant.slug,
      params.subscription.tenant.customDomains.map((d) => d.hostname),
    );

    const recipientEmail =
      params.subscription.tenant.contactEmail || params.subscription.tenant.owner.email;
    await this.notificationsService.sendSubscriptionPaymentApproved({
      to: recipientEmail,
      ownerName: params.subscription.tenant.owner.fullName,
      storeName: params.subscription.tenant.name,
      planName: params.subscription.plan.name,
      amount: params.amount.toFixed(2),
      currency: params.currency,
      externalReference: params.externalReference,
    });
  }

  private async markSubscriptionPastDue(
    subscription: Subscription & {
      plan: Plan;
      tenant: Tenant & {
        owner: { id: string; email: string; fullName: string };
        customDomains: Array<{ hostname: string }>;
      };
    },
    now: Date = new Date(),
    graceDaysOverride?: number,
  ) {
    const graceDays =
      graceDaysOverride ?? this.config.get('SUBSCRIPTION_GRACE_DAYS', { infer: true }) ?? 5;
    const graceEndsAt = new Date(now.getTime() + graceDays * MS_PER_DAY);

    await this.prisma.$transaction(async (tx) => {
      await tx.subscription.update({
        where: { id: subscription.id },
        data: {
          status: SubscriptionStatus.PAST_DUE,
          gracePeriodEndsAt: graceEndsAt,
        },
      });

      await tx.tenant.update({
        where: { id: subscription.tenantId },
        data: { status: TenantStatus.PAST_DUE },
      });
    });

    await this.tenantResolutionService.invalidateTenantCache(
      subscription.tenant.slug,
      subscription.tenant.customDomains.map((d) => d.hostname),
    );

    const frontendUrl = this.config.get('FRONTEND_URL', { infer: true });
    const recipientEmail = subscription.tenant.contactEmail || subscription.tenant.owner.email;
    await this.notificationsService.sendSubscriptionGracePeriod({
      to: recipientEmail,
      ownerName: subscription.tenant.owner.fullName,
      storeName: subscription.tenant.name,
      planName: subscription.plan.name,
      graceEndsAt: graceEndsAt.toISOString().slice(0, 10),
      graceDays,
      billingUrl: `${frontendUrl}/dashboard`,
    });
  }

  private async suspendSubscription(
    subscription: Subscription & {
      plan: Plan;
      tenant: Tenant & {
        owner: { id: string; email: string; fullName: string };
        customDomains: Array<{ hostname: string }>;
      };
    },
    targetSubStatus: SubscriptionStatus = SubscriptionStatus.SUSPENDED,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await tx.subscription.update({
        where: { id: subscription.id },
        data: { status: targetSubStatus },
      });

      await tx.tenant.update({
        where: { id: subscription.tenantId },
        data: { status: TenantStatus.SUSPENDED },
      });
    });

    await this.tenantResolutionService.invalidateTenantCache(
      subscription.tenant.slug,
      subscription.tenant.customDomains.map((d) => d.hostname),
    );

    const frontendUrl = this.config.get('FRONTEND_URL', { infer: true });
    const recipientEmail = subscription.tenant.contactEmail || subscription.tenant.owner.email;
    await this.notificationsService.sendSubscriptionSuspended({
      to: recipientEmail,
      ownerName: subscription.tenant.owner.fullName,
      storeName: subscription.tenant.name,
      planName: subscription.plan.name,
      billingUrl: `${frontendUrl}/dashboard`,
    });
  }

  private verifyStripeSignature(
    payload: StripeWebhookPayloadDto,
    signatureHeader: string | undefined,
    secret: string,
  ): void {
    if (!signatureHeader) {
      throw new UnauthorizedException('Falta cabecera stripe-signature.');
    }

    const parts = Object.fromEntries(
      signatureHeader.split(',').map((item) => {
        const [k, v] = item.trim().split('=');
        return [k, v];
      }),
    );

    const timestamp = parts['t'];
    const v1 = parts['v1'];
    if (!timestamp || !v1) {
      throw new UnauthorizedException('Cabecera stripe-signature con formato inválido.');
    }

    const signedPayload = `${timestamp}.${JSON.stringify(payload)}`;
    const expected = createHmac('sha256', secret).update(signedPayload).digest('hex');

    const providedBuf = Buffer.from(v1, 'utf8');
    const expectedBuf = Buffer.from(expected, 'utf8');
    if (providedBuf.length !== expectedBuf.length || !timingSafeEqual(providedBuf, expectedBuf)) {
      throw new UnauthorizedException('Firma de webhook Stripe inválida.');
    }
  }

  private verifyHmacSignature(
    rawPayload: string,
    signatureHeader: string | undefined,
    secret: string,
  ): void {
    if (!signatureHeader) {
      throw new UnauthorizedException('Falta cabecera x-signature.');
    }
    const expected = createHmac('sha256', secret).update(rawPayload).digest('hex');
    const providedBuf = Buffer.from(signatureHeader.trim(), 'utf8');
    const expectedBuf = Buffer.from(expected, 'utf8');
    if (providedBuf.length !== expectedBuf.length || !timingSafeEqual(providedBuf, expectedBuf)) {
      throw new UnauthorizedException('Firma de webhook MercadoPago inválida.');
    }
  }

  private serializePlan(plan: Plan) {
    return {
      id: plan.id,
      code: plan.code,
      name: plan.name,
      description: plan.description,
      priceMonthly: Number(plan.priceMonthly),
      priceYearly: Number(plan.priceYearly),
      currency: plan.currency,
      maxProducts: plan.maxProducts,
      maxStaff: plan.maxStaff,
      allowCustomDomain: plan.allowCustomDomain,
      allowCsvImport: plan.allowCsvImport,
      allowAbandonedCart: plan.allowAbandonedCart,
      allowWholesale: plan.allowWholesale,
      allowCoupons: plan.allowCoupons,
    };
  }

  private serializePayment(payment: SubscriptionPayment): SubscriptionPaymentItemDto {
    return {
      id: payment.id,
      provider: payment.provider,
      amount: Number(payment.amount),
      currency: payment.currency,
      externalReference: payment.externalReference,
      receiptFileKey: payment.receiptFileKey,
      reviewStatus: payment.reviewStatus,
      paidAt: payment.paidAt ? payment.paidAt.toISOString() : null,
      createdAt: payment.createdAt.toISOString(),
    };
  }
}
