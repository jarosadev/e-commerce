'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  CreditCard,
  ExternalLink,
  Landmark,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { DashboardNav } from '@/components/dashboard/DashboardNav';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import apiClient from '@/lib/api-client';
import { extractErrorMessage, formatDate, formatMoney, statusBadgeClass } from '@/lib/format';

interface TenantListItem {
  id: string;
  slug: string;
  name: string;
  status: string;
}

interface SubscriptionPlanItem {
  id: string;
  code: string;
  name: string;
  description: string | null;
  priceMonthly: number;
  priceYearly: number;
  currency: string;
  maxProducts: number;
  maxStaff: number;
  allowCustomDomain: boolean;
  allowCsvImport: boolean;
  allowAbandonedCart: boolean;
  allowWholesale: boolean;
  allowCoupons: boolean;
}

interface SubscriptionPaymentItem {
  id: string;
  provider: string;
  amount: number;
  currency: string;
  externalReference: string | null;
  receiptFileKey: string | null;
  reviewStatus: string;
  paidAt: string | null;
  createdAt: string;
}

interface SubscriptionSummary {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  tenantStatus: string;
  subscriptionId: string;
  status: string;
  billingCycle: 'MONTHLY' | 'YEARLY';
  currentPeriodStart: string;
  currentPeriodEnd: string;
  gracePeriodEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  daysUntilPeriodEnd: number;
  isInGracePeriod: boolean;
  graceDaysRemaining: number;
  plan: SubscriptionPlanItem;
  usage: {
    productsUsed: number;
    maxProducts: number;
    productsUsagePercent: number;
    staffUsed: number;
    maxStaff: number;
    staffUsagePercent: number;
  };
  payments: SubscriptionPaymentItem[];
  availablePlans: SubscriptionPlanItem[];
}

export default function DashboardPage() {
  const [stores, setStores] = useState<TenantListItem[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string>('');
  const [summary, setSummary] = useState<SubscriptionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Plan switching & checkout state
  const [selectedCycle, setSelectedCycle] = useState<'MONTHLY' | 'YEARLY'>('MONTHLY');
  const [actionBusy, setActionBusy] = useState(false);

  // Manual transfer payment form
  const [manualAmount, setManualAmount] = useState('49');
  const [manualRef, setManualRef] = useState('');
  const [manualReceiptKey, setManualReceiptKey] = useState('');

  const loadSubscription = useCallback(async (slugOverride?: string) => {
    try {
      const headers: Record<string, string> = {};
      if (slugOverride) {
        headers['x-tenant-slug'] = slugOverride;
      }
      const [storesRes, subRes] = await Promise.all([
        apiClient.get<TenantListItem[]>('/tenants'),
        apiClient.get<SubscriptionSummary>('/subscriptions/current', { headers }),
      ]);
      setError(null);
      setStores(storesRes.data);
      setSummary(subRes.data);
      setSelectedSlug(subRes.data.tenantSlug);
      setSelectedCycle(subRes.data.billingCycle);
      const price =
        subRes.data.billingCycle === 'YEARLY'
          ? subRes.data.plan.priceYearly
          : subRes.data.plan.priceMonthly;
      setManualAmount(String(price));
    } catch (err) {
      setError(
        extractErrorMessage(
          err,
          'No pudimos cargar tu suscripción. Verifica tu sesión o crea tu primera tienda.',
        ),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const run = async () => {
      if (active) {
        await loadSubscription();
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, [loadSubscription]);

  const handleSelectStore = (slug: string) => {
    setSelectedSlug(slug);
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('x-tenant-host', `${slug}.localhost:3000`);
    }
    void loadSubscription(slug);
  };

  const handleChangePlan = async (planCode: string) => {
    if (!summary) return;
    setActionBusy(true);
    setFeedback(null);
    setError(null);
    try {
      const res = await apiClient.post<SubscriptionSummary>(
        '/subscriptions/change-plan',
        { planCode, billingCycle: selectedCycle },
        { headers: { 'x-tenant-slug': summary.tenantSlug } },
      );
      setSummary(res.data);
      setFeedback(`Plan actualizado a ${res.data.plan.name} (${res.data.billingCycle}).`);
    } catch (err) {
      setError(extractErrorMessage(err, 'No se pudo cambiar el plan.'));
    } finally {
      setActionBusy(false);
    }
  };

  const handleGatewayCheckout = async (provider: 'stripe' | 'mercadopago') => {
    if (!summary) return;
    setActionBusy(true);
    setFeedback(null);
    setError(null);
    try {
      const res = await apiClient.post<{
        provider: string;
        mode: string;
        sessionId: string;
        checkoutUrl: string;
        amount: number;
        currency: string;
      }>(
        `/subscriptions/checkout/${provider}`,
        { planCode: summary.plan.code, billingCycle: selectedCycle },
        { headers: { 'x-tenant-slug': summary.tenantSlug } },
      );
      setFeedback(
        `Sesión ${res.data.provider} (${res.data.mode.toUpperCase()}) creada: ${res.data.sessionId} por ${formatMoney(res.data.amount, res.data.currency)}.`,
      );
    } catch (err) {
      setError(extractErrorMessage(err, `No se pudo iniciar checkout con ${provider}.`));
    } finally {
      setActionBusy(false);
    }
  };

  const handleSubmitManualPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!summary) return;
    setActionBusy(true);
    setFeedback(null);
    setError(null);
    try {
      await apiClient.post(
        '/subscriptions/manual-payments',
        {
          amount: Number(manualAmount),
          currency: summary.plan.currency,
          externalReference: manualRef.trim(),
          receiptFileKey: manualReceiptKey.trim() || undefined,
          billingCycle: selectedCycle,
        },
        { headers: { 'x-tenant-slug': summary.tenantSlug } },
      );
      setManualRef('');
      setManualReceiptKey('');
      setFeedback('Comprobante enviado correctamente. Quedó pendiente de aprobación por SuperAdmin.');
      await loadSubscription(summary.tenantSlug);
    } catch (err) {
      setError(extractErrorMessage(err, 'No se pudo registrar el pago manual.'));
    } finally {
      setActionBusy(false);
    }
  };

  const handleToggleCancel = async () => {
    if (!summary) return;
    setActionBusy(true);
    setFeedback(null);
    setError(null);
    try {
      const res = await apiClient.post<SubscriptionSummary>(
        '/subscriptions/cancel',
        { cancelAtPeriodEnd: !summary.cancelAtPeriodEnd },
        { headers: { 'x-tenant-slug': summary.tenantSlug } },
      );
      setSummary(res.data);
      setFeedback(
        res.data.cancelAtPeriodEnd
          ? 'Renovación automática pausada al finalizar el período actual.'
          : 'Renovación automática reactivada correctamente.',
      );
    } catch (err) {
      setError(extractErrorMessage(err, 'No se pudo actualizar la renovación.'));
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <DashboardNav
        stores={stores}
        selectedSlug={selectedSlug}
        onSelectStore={handleSelectStore}
        onRefresh={() => void loadSubscription(selectedSlug || undefined)}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 flex items-center justify-between gap-4">
            <span>{error}</span>
            <Link href="/dashboard/onboarding">
              <Button size="sm" variant="outline">
                Crear mi primera tienda
              </Button>
            </Link>
          </div>
        )}

        {feedback && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 flex items-center gap-2">
            <CheckCircle2 className="size-4 shrink-0" />
            <span>{feedback}</span>
          </div>
        )}

        {loading && !summary && (
          <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center text-sm text-slate-500">
            Cargando información de tu tienda y suscripción...
          </div>
        )}

        {summary && (
          <>
            {/* Alertas de período de gracia o suspensión */}
            {summary.tenantStatus === 'PAST_DUE' && (
              <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 flex items-start gap-3 text-amber-900">
                <AlertTriangle className="size-5 shrink-0 mt-0.5 text-amber-600" />
                <div className="text-sm">
                  <p className="font-semibold">
                    Tu tienda ingresó en Período de Gracia ({summary.graceDaysRemaining} días
                    restantes)
                  </p>
                  <p className="text-amber-800 mt-0.5">
                    Regulariza tu pago antes del {formatDate(summary.gracePeriodEndsAt)} para evitar
                    la suspensión automática del storefront.
                  </p>
                </div>
              </div>
            )}

            {summary.tenantStatus === 'SUSPENDED' && (
              <div className="rounded-2xl border border-rose-300 bg-rose-50 p-4 flex items-start gap-3 text-rose-900">
                <AlertTriangle className="size-5 shrink-0 mt-0.5 text-rose-600" />
                <div className="text-sm">
                  <p className="font-semibold">Tienda suspendida temporalmente</p>
                  <p className="text-rose-800 mt-0.5">
                    Tus productos y datos están a salvo. Completa el pago online o sube tu
                    comprobante abajo para reactivar tu tienda de inmediato.
                  </p>
                </div>
              </div>
            )}

            {/* Resumen superior: Estado + Cuotas */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              <div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-xl font-bold text-slate-900">{summary.tenantName}</h2>
                      <span
                        className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border ${statusBadgeClass(summary.tenantStatus)}`}
                      >
                        {summary.tenantStatus}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-1 font-mono">
                      Subdominio: {summary.tenantSlug}.vendexa.app
                    </p>
                  </div>
                  <Link
                    href={`/store/${summary.tenantSlug}`}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-700"
                  >
                    Ver Storefront Público <ExternalLink className="size-3.5" />
                  </Link>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-slate-100">
                  <div>
                    <p className="text-[11px] uppercase font-semibold text-slate-400">Plan actual</p>
                    <p className="text-sm font-bold text-slate-900 mt-0.5">{summary.plan.name}</p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase font-semibold text-slate-400">Estado sub.</p>
                    <p className="text-sm font-bold text-slate-900 mt-0.5">{summary.status}</p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase font-semibold text-slate-400">Ciclo</p>
                    <p className="text-sm font-bold text-slate-900 mt-0.5">
                      {summary.billingCycle === 'YEARLY' ? 'Anual' : 'Mensual'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase font-semibold text-slate-400">
                      Próximo corte
                    </p>
                    <p className="text-sm font-bold text-slate-900 mt-0.5">
                      {formatDate(summary.currentPeriodEnd)} ({summary.daysUntilPeriodEnd}d)
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 pt-2">
                  {[
                    { label: 'Mayorista B2B', enabled: summary.plan.allowWholesale },
                    { label: 'Dominio Propio SSL', enabled: summary.plan.allowCustomDomain },
                    { label: 'Importador CSV/Excel', enabled: summary.plan.allowCsvImport },
                    { label: 'Carritos Abandonados', enabled: summary.plan.allowAbandonedCart },
                    { label: 'Cupones', enabled: summary.plan.allowCoupons },
                  ].map((feat) => (
                    <span
                      key={feat.label}
                      className={`text-xs px-2.5 py-1 rounded-md border ${
                        feat.enabled
                          ? 'bg-indigo-50 text-indigo-700 border-indigo-200 font-medium'
                          : 'bg-slate-50 text-slate-400 border-slate-200 line-through'
                      }`}
                    >
                      {feat.label}
                    </span>
                  ))}
                </div>
              </div>

              {/* Consumo de Cuotas del Plan */}
              <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
                <div className="flex items-center gap-2 font-semibold text-sm text-slate-900">
                  <ShieldCheck className="size-4 text-indigo-600" />
                  <span>Consumo de cuotas del plan</span>
                </div>

                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs">
                      <span className="font-medium text-slate-700">Productos activos</span>
                      <span className="font-semibold text-slate-900">
                        {summary.usage.productsUsed} / {summary.usage.maxProducts.toLocaleString()}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className="h-full bg-indigo-600 rounded-full"
                        style={{ width: `${summary.usage.productsUsagePercent}%` }}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs">
                      <span className="font-medium text-slate-700">Equipo (Staff)</span>
                      <span className="font-semibold text-slate-900">
                        {summary.usage.staffUsed} / {summary.usage.maxStaff}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className="h-full bg-emerald-600 rounded-full"
                        style={{ width: `${summary.usage.staffUsagePercent}%` }}
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-100">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={actionBusy}
                    onClick={() => void handleToggleCancel()}
                    className="w-full"
                  >
                    {summary.cancelAtPeriodEnd
                      ? 'Reactivar renovación automática'
                      : 'Pausar renovación al fin del período'}
                  </Button>
                </div>
              </div>
            </div>

            {/* Pagos Online (Stripe / MercadoPago) + Transferencia Manual */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
                <div className="flex items-center gap-2 font-semibold text-slate-900">
                  <CreditCard className="size-5 text-indigo-600" />
                  <h3>Cobro Automático de Suscripción</h3>
                </div>
                <p className="text-xs text-slate-500">
                  Activa renovación recurrente automática con Stripe Billing o MercadoPago. Tu tienda
                  se activa al instante al confirmarse el webhook.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <Button
                    type="button"
                    disabled={actionBusy}
                    onClick={() => void handleGatewayCheckout('stripe')}
                    className="h-10"
                  >
                    Pagar con Stripe <ArrowUpRight className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={actionBusy}
                    onClick={() => void handleGatewayCheckout('mercadopago')}
                    className="h-10"
                  >
                    Pagar con MercadoPago <ArrowUpRight className="size-4" />
                  </Button>
                </div>
              </div>

              <form
                onSubmit={handleSubmitManualPayment}
                className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4"
              >
                <div className="flex items-center gap-2 font-semibold text-slate-900">
                  <Landmark className="size-5 text-emerald-600" />
                  <h3>Reportar Pago Manual (Transferencia / QR)</h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-700">
                      Monto ({summary.plan.currency})
                    </label>
                    <Input
                      type="number"
                      step="0.01"
                      required
                      value={manualAmount}
                      onChange={(e) => setManualAmount(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-700">
                      Nro. de Referencia / Operación *
                    </label>
                    <Input
                      required
                      placeholder="TRF-2026-9910"
                      value={manualRef}
                      onChange={(e) => setManualRef(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <label className="text-xs font-medium text-slate-700">
                      URL o clave de comprobante (opcional)
                    </label>
                    <Input
                      placeholder="receipts/2026/comprobante.pdf"
                      value={manualReceiptKey}
                      onChange={(e) => setManualReceiptKey(e.target.value)}
                    />
                  </div>
                </div>
                <Button type="submit" disabled={actionBusy || !manualRef.trim()} className="w-full">
                  Enviar comprobante para aprobación
                </Button>
              </form>
            </div>

            {/* Cambio de Plan */}
            <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 font-semibold text-slate-900">
                  <Sparkles className="size-5 text-indigo-600" />
                  <h3>Planes SaaS Disponibles</h3>
                </div>
                <div className="inline-flex rounded-lg border border-slate-200 p-0.5 bg-slate-100 text-xs">
                  <button
                    type="button"
                    onClick={() => setSelectedCycle('MONTHLY')}
                    className={`px-3 py-1 rounded-md font-medium ${
                      selectedCycle === 'MONTHLY'
                        ? 'bg-white shadow-sm text-slate-900'
                        : 'text-slate-600'
                    }`}
                  >
                    Mensual
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedCycle('YEARLY')}
                    className={`px-3 py-1 rounded-md font-medium ${
                      selectedCycle === 'YEARLY'
                        ? 'bg-white shadow-sm text-slate-900'
                        : 'text-slate-600'
                    }`}
                  >
                    Anual
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {summary.availablePlans.map((plan) => {
                  const isCurrent =
                    plan.code === summary.plan.code && selectedCycle === summary.billingCycle;
                  const price =
                    selectedCycle === 'YEARLY' ? plan.priceYearly : plan.priceMonthly;
                  return (
                    <div
                      key={plan.id}
                      className={`rounded-xl border p-5 flex flex-col justify-between gap-4 ${
                        isCurrent ? 'border-indigo-600 bg-indigo-50/30' : 'border-slate-200'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between">
                          <h4 className="font-bold text-slate-900">{plan.name}</h4>
                          {isCurrent && (
                            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-indigo-600 text-white">
                              Actual
                            </span>
                          )}
                        </div>
                        <p className="text-2xl font-bold text-slate-900 mt-2">
                          {formatMoney(price, plan.currency)}
                          <span className="text-xs font-normal text-slate-500">
                            /{selectedCycle === 'YEARLY' ? 'año' : 'mes'}
                          </span>
                        </p>
                        <p className="text-xs text-slate-500 mt-2">{plan.description}</p>
                        <ul className="mt-3 space-y-1 text-xs text-slate-700">
                          <li>• Hasta {plan.maxProducts.toLocaleString()} productos</li>
                          <li>• Hasta {plan.maxStaff} usuarios de equipo</li>
                          <li>
                            •{' '}
                            {plan.allowCustomDomain
                              ? 'Dominio propio + SSL automático'
                              : 'Subdominio automático'}
                          </li>
                          <li>
                            • {plan.allowCsvImport ? 'Importación masiva Excel/CSV' : 'Carga manual'}
                          </li>
                        </ul>
                      </div>
                      <Button
                        type="button"
                        variant={isCurrent ? 'outline' : 'default'}
                        disabled={isCurrent || actionBusy}
                        onClick={() => void handleChangePlan(plan.code)}
                        className="w-full"
                      >
                        {isCurrent ? 'Plan activo' : 'Cambiar a este plan'}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Historial de pagos SaaS */}
            <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
              <h3 className="font-semibold text-slate-900">Historial de pagos de suscripción</h3>
              {summary.payments.length === 0 ? (
                <p className="text-sm text-slate-500">
                  Aún no hay pagos registrados para esta suscripción.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="text-xs uppercase text-slate-400 border-b border-slate-100">
                      <tr>
                        <th className="py-2.5 pr-4">Fecha</th>
                        <th className="py-2.5 pr-4">Proveedor</th>
                        <th className="py-2.5 pr-4">Referencia</th>
                        <th className="py-2.5 pr-4">Monto</th>
                        <th className="py-2.5">Estado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {summary.payments.map((p) => (
                        <tr key={p.id}>
                          <td className="py-2.5 pr-4 text-slate-600">{formatDate(p.createdAt)}</td>
                          <td className="py-2.5 pr-4 font-medium text-slate-800">{p.provider}</td>
                          <td className="py-2.5 pr-4 font-mono text-xs text-slate-600">
                            {p.externalReference ?? '—'}
                          </td>
                          <td className="py-2.5 pr-4 font-semibold text-slate-900">
                            {formatMoney(p.amount, p.currency)}
                          </td>
                          <td className="py-2.5">
                            <span
                              className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border ${statusBadgeClass(p.reviewStatus)}`}
                            >
                              {p.reviewStatus}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
