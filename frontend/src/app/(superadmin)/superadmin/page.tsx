'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  Check,
  CreditCard,
  DollarSign,
  Layers,
  MessageSquarePlus,
  Play,
  RefreshCw,
  Search,
  Shield,
  Store,
  Users,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import apiClient from '@/lib/api-client';
import { extractErrorMessage, formatDate, formatMoney, statusBadgeClass } from '@/lib/format';

interface PlatformOverview {
  totalStores: number;
  activeStores: number;
  trialStores: number;
  pastDueStores: number;
  suspendedStores: number;
  newStoresLast30Days: number;
  storesAtRisk: number;
  totalOwners: number;
  activeSubscriptions: number;
  mrr: number;
  recentCollectedRevenue: number;
  pendingPayments: number;
  approvedPaymentsCount: number;
  totalCollectedRevenue: number;
  totalCustomers: number;
  totalOrders: number;
}

interface CrmTenant {
  id: string;
  slug: string;
  name: string;
  status: string;
  subscription: {
    id: string;
    status: string;
    billingCycle: string;
    currentPeriodEnd: string;
    plan: { code: string; name: string; maxProducts: number; maxStaff: number };
  } | null;
  usage?: {
    productsUsed: number;
    maxProducts: number;
    productsUsagePercent: number;
    staffUsed: number;
    maxStaff: number;
  };
}

interface CrmClient {
  id: string;
  email: string;
  fullName: string;
  isActive: boolean;
  createdAt: string;
  ownerProfile: {
    legalName: string | null;
    taxId: string | null;
    phoneWhatsapp: string | null;
    country: string | null;
    city: string | null;
    businessCategory: string | null;
    internalAdminNotes: string | null;
  } | null;
  ownedTenants: CrmTenant[];
}

interface AdminPaymentItem {
  id: string;
  provider: string;
  amount: number;
  currency: string;
  externalReference: string | null;
  reviewStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  createdAt: string;
  subscription: {
    plan: { name: string };
    tenant: {
      id: string;
      name: string;
      slug: string;
      owner?: { fullName: string; email: string };
    };
  };
}

interface SaaSPlan {
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
}

export default function SuperAdminPage() {
  const [activeTab, setActiveTab] = useState<'crm' | 'payments' | 'plans'>('crm');
  const [overview, setOverview] = useState<PlatformOverview | null>(null);
  const [clients, setClients] = useState<CrmClient[]>([]);
  const [payments, setPayments] = useState<AdminPaymentItem[]>([]);
  const [plans, setPlans] = useState<SaaSPlan[]>([]);

  // CRM filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [planFilter, setPlanFilter] = useState('');
  const [selectedClient, setSelectedClient] = useState<CrmClient | null>(null);
  const [newNote, setNewNote] = useState('');

  // Payments filter
  const [paymentFilter, setPaymentFilter] = useState<'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED'>(
    'PENDING',
  );
  const [rejectNote, setRejectNote] = useState('');

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const [ovRes, clientsRes, payRes, plansRes] = await Promise.all([
        apiClient.get<PlatformOverview>('/platform-admin/overview'),
        apiClient.get<{ items: CrmClient[] }>('/platform-admin/clients', {
          params: {
            search: search.trim() || undefined,
            tenantStatus: statusFilter || undefined,
            planCode: planFilter || undefined,
          },
        }),
        apiClient.get<{ items: AdminPaymentItem[] }>('/platform-admin/payments', {
          params: {
            reviewStatus: paymentFilter === 'ALL' ? undefined : paymentFilter,
          },
        }),
        apiClient.get<SaaSPlan[]>('/plans'),
      ]);

      setError(null);
      setOverview(ovRes.data);
      setClients(clientsRes.data.items ?? []);
      setPayments(payRes.data.items ?? []);
      setPlans(plansRes.data ?? []);
    } catch (err) {
      setError(
        extractErrorMessage(
          err,
          'Se requiere sesión de SUPER_ADMIN para acceder a la consola CRM.',
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, planFilter, paymentFilter]);

  useEffect(() => {
    let active = true;
    const run = async () => {
      if (active) {
        await loadAll();
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, [loadAll]);

  const handleAppendNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClient || !newNote.trim()) return;
    setBusy(true);
    setToast(null);
    try {
      const res = await apiClient.post<CrmClient>(
        `/platform-admin/clients/${selectedClient.id}/notes`,
        { note: newNote.trim() },
      );
      setSelectedClient(res.data);
      setNewNote('');
      setToast('Nota fechada agregada a la bitácora CRM.');
      await loadAll();
    } catch (err) {
      setError(extractErrorMessage(err, 'No se pudo guardar la nota.'));
    } finally {
      setBusy(false);
    }
  };

  const handleTenantStatusChange = async (tenantId: string, status: string) => {
    setBusy(true);
    setToast(null);
    try {
      await apiClient.patch(`/platform-admin/tenants/${tenantId}/status`, { status });
      setToast(`Estado de tienda actualizado a ${status}.`);
      await loadAll();
    } catch (err) {
      setError(extractErrorMessage(err, 'No se pudo actualizar el estado de la tienda.'));
    } finally {
      setBusy(false);
    }
  };

  const handleReviewPayment = async (
    paymentId: string,
    reviewStatus: 'APPROVED' | 'REJECTED',
  ) => {
    setBusy(true);
    setToast(null);
    try {
      await apiClient.patch(`/platform-admin/payments/${paymentId}/review`, {
        reviewStatus,
        note: reviewStatus === 'REJECTED' ? rejectNote.trim() || 'Comprobante inválido' : undefined,
      });
      setRejectNote('');
      setToast(
        reviewStatus === 'APPROVED'
          ? 'Pago aprobado: tienda y suscripción activadas + email enviado.'
          : 'Pago rechazado y notificación enviada al dueño de tienda.',
      );
      await loadAll();
    } catch (err) {
      setError(extractErrorMessage(err, 'No se pudo procesar la revisión del pago.'));
    } finally {
      setBusy(false);
    }
  };

  const handleRunLifecycleCheck = async () => {
    setBusy(true);
    setToast(null);
    try {
      const res = await apiClient.post<{
        remindedCount: number;
        movedToGraceCount: number;
        suspendedCount: number;
        canceledAtPeriodEndCount: number;
      }>('/platform-admin/subscriptions/run-lifecycle-check');
      setToast(
        `Chequeo ejecutado: ${res.data.remindedCount} avisos, ${res.data.movedToGraceCount} a período de gracia, ${res.data.suspendedCount} suspendidas.`,
      );
      await loadAll();
    } catch (err) {
      setError(extractErrorMessage(err, 'No se pudo ejecutar el ciclo de vencimientos.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-slate-900 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-lg bg-indigo-600 flex items-center justify-center">
              <Shield className="size-5" />
            </div>
            <div>
              <h1 className="text-base font-bold leading-tight">SuperAdmin CRM Directory</h1>
              <p className="text-xs text-slate-400">
                Gobierno SaaS · MRR · Suscripciones · Control de Tiendas
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => void handleRunLifecycleCheck()}
            >
              <Play className="size-3.5" /> Ejecutar chequeo mora/cortes
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-slate-900 bg-white"
              onClick={() => void loadAll()}
            >
              <RefreshCw className="size-3.5" />
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 flex items-center gap-2">
            <AlertCircle className="size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {toast && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {toast}
          </div>
        )}

        {/* Executive KPI Cards */}
        {overview && (
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="bg-white border border-slate-200 rounded-2xl p-4">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>MRR Normalizado</span>
                <DollarSign className="size-4 text-emerald-600" />
              </div>
              <p className="text-2xl font-bold text-slate-900 mt-1">{formatMoney(overview.mrr)}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {overview.activeSubscriptions} suscripciones activas
              </p>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-4">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Tiendas Totales</span>
                <Store className="size-4 text-indigo-600" />
              </div>
              <p className="text-2xl font-bold text-slate-900 mt-1">{overview.totalStores}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {overview.activeStores} activas · {overview.trialStores} trial
              </p>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-4">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Tiendas en Riesgo</span>
                <AlertCircle className="size-4 text-amber-600" />
              </div>
              <p className="text-2xl font-bold text-slate-900 mt-1">{overview.storesAtRisk}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {overview.pastDueStores} gracia · {overview.suspendedStores} suspendidas
              </p>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-4">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Pagos por Aprobar</span>
                <CreditCard className="size-4 text-rose-600" />
              </div>
              <p className="text-2xl font-bold text-slate-900 mt-1">{overview.pendingPayments}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Total cobrado: {formatMoney(overview.totalCollectedRevenue)}
              </p>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-4 col-span-2 lg:col-span-1">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Ecosistema</span>
                <Users className="size-4 text-sky-600" />
              </div>
              <p className="text-2xl font-bold text-slate-900 mt-1">{overview.totalOwners}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {overview.totalCustomers} compradores · {overview.totalOrders} pedidos
              </p>
            </div>
          </div>
        )}

        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 border-b border-slate-200">
          {[
            { id: 'crm', label: 'CRM Clientes & Tiendas', icon: Users },
            {
              id: 'payments',
              label: `Pagos SaaS (${overview?.pendingPayments ?? 0} pendientes)`,
              icon: CreditCard,
            },
            { id: 'plans', label: 'Planes SaaS', icon: Layers },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as 'crm' | 'payments' | 'plans')}
                className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
                  active
                    ? 'border-indigo-600 text-indigo-700'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <Icon className="size-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* TAB 1: CRM DIRECTORY */}
        {activeTab === 'crm' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-4">
              <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-wrap gap-3">
                <div className="relative flex-1 min-w-52">
                  <Search className="size-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <Input
                    className="pl-9"
                    placeholder="Buscar dueño, email, RUC/DNI o tienda..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="h-9 rounded-lg border border-slate-200 px-3 text-xs font-medium bg-white"
                >
                  <option value="">Todos los estados</option>
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="TRIAL">TRIAL</option>
                  <option value="PAST_DUE">PAST_DUE</option>
                  <option value="SUSPENDED">SUSPENDED</option>
                </select>
                <select
                  value={planFilter}
                  onChange={(e) => setPlanFilter(e.target.value)}
                  className="h-9 rounded-lg border border-slate-200 px-3 text-xs font-medium bg-white"
                >
                  <option value="">Todos los planes</option>
                  {plans.map((p) => (
                    <option key={p.id} value={p.code}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="bg-white border border-slate-200 rounded-2xl divide-y divide-slate-100">
                {loading && clients.length === 0 && (
                  <p className="p-8 text-center text-sm text-slate-500">Cargando clientes CRM...</p>
                )}
                {!loading && clients.length === 0 && (
                  <p className="p-8 text-center text-sm text-slate-500">
                    No se encontraron clientes con los filtros seleccionados.
                  </p>
                )}
                {clients.map((client) => (
                  <div
                    key={client.id}
                    onClick={() => setSelectedClient(client)}
                    className={`p-4 cursor-pointer transition-colors hover:bg-slate-50 ${
                      selectedClient?.id === client.id ? 'bg-indigo-50/40' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-900">{client.fullName}</p>
                        <p className="text-xs text-slate-500">{client.email}</p>
                        {client.ownerProfile?.legalName && (
                          <p className="text-xs text-slate-600 mt-1">
                            {client.ownerProfile.legalName}
                            {client.ownerProfile.taxId ? ` · ID: ${client.ownerProfile.taxId}` : ''}
                          </p>
                        )}
                      </div>
                      <span className="text-xs text-slate-400">
                        Alta: {formatDate(client.createdAt)}
                      </span>
                    </div>

                    {client.ownedTenants.length > 0 && (
                      <div className="mt-3 space-y-2">
                        {client.ownedTenants.map((tenant) => (
                          <div
                            key={tenant.id}
                            className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs"
                          >
                            <div>
                              <span className="font-semibold text-slate-900">{tenant.name}</span>{' '}
                              <span className="font-mono text-slate-500">({tenant.slug})</span>
                              {tenant.subscription && (
                                <span className="ml-2 text-indigo-700 font-medium">
                                  {tenant.subscription.plan.name}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-3">
                              {tenant.usage && (
                                <span className="text-slate-600">
                                  Productos: <strong>{tenant.usage.productsUsed}</strong>/
                                  {tenant.usage.maxProducts} ({tenant.usage.productsUsagePercent}%)
                                </span>
                              )}
                              <span
                                className={`font-semibold px-2 py-0.5 rounded-full border ${statusBadgeClass(tenant.status)}`}
                              >
                                {tenant.status}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Ficha CRM Lateral */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-5 h-fit">
              {!selectedClient ? (
                <p className="text-sm text-slate-500 text-center py-8">
                  Selecciona un cliente del directorio para ver su ficha fiscal, gestionar el estado
                  de sus tiendas y registrar notas de seguimiento.
                </p>
              ) : (
                <>
                  <div>
                    <h3 className="font-bold text-slate-900 text-base">{selectedClient.fullName}</h3>
                    <p className="text-xs text-slate-500">{selectedClient.email}</p>
                  </div>

                  <div className="space-y-1.5 text-xs text-slate-700 border-t border-slate-100 pt-3">
                    <p>
                      <strong>Razón Social:</strong> {selectedClient.ownerProfile?.legalName || '—'}
                    </p>
                    <p>
                      <strong>RUC / DNI:</strong> {selectedClient.ownerProfile?.taxId || '—'}
                    </p>
                    <p>
                      <strong>WhatsApp:</strong> {selectedClient.ownerProfile?.phoneWhatsapp || '—'}
                    </p>
                    <p>
                      <strong>Ubicación:</strong>{' '}
                      {[selectedClient.ownerProfile?.city, selectedClient.ownerProfile?.country]
                        .filter(Boolean)
                        .join(', ') || '—'}
                    </p>
                    <p>
                      <strong>Rubro:</strong> {selectedClient.ownerProfile?.businessCategory || '—'}
                    </p>
                  </div>

                  {selectedClient.ownedTenants.length > 0 && (
                    <div className="space-y-2 border-t border-slate-100 pt-3">
                      <p className="text-xs font-semibold uppercase text-slate-400">
                        Control rápido de tiendas
                      </p>
                      {selectedClient.ownedTenants.map((t) => (
                        <div key={t.id} className="flex items-center justify-between gap-2 text-xs">
                          <span className="font-medium text-slate-800 truncate">{t.name}</span>
                          <select
                            disabled={busy}
                            value={t.status}
                            onChange={(e) => void handleTenantStatusChange(t.id, e.target.value)}
                            className="h-7 rounded border border-slate-200 px-2 text-xs bg-white"
                          >
                            <option value="TRIAL">TRIAL</option>
                            <option value="ACTIVE">ACTIVE</option>
                            <option value="PAST_DUE">PAST_DUE</option>
                            <option value="SUSPENDED">SUSPENDED</option>
                          </select>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="space-y-2 border-t border-slate-100 pt-3">
                    <p className="text-xs font-semibold uppercase text-slate-400">
                      Bitácora interna de notas
                    </p>
                    <pre className="whitespace-pre-wrap text-xs bg-slate-50 border border-slate-200 rounded-xl p-3 text-slate-700 max-h-44 overflow-y-auto font-sans">
                      {selectedClient.ownerProfile?.internalAdminNotes ||
                        'Sin notas internas registradas.'}
                    </pre>
                    <form onSubmit={handleAppendNote} className="space-y-2">
                      <Input
                        placeholder="Agregar nota fechada de seguimiento..."
                        value={newNote}
                        onChange={(e) => setNewNote(e.target.value)}
                      />
                      <Button
                        type="submit"
                        size="sm"
                        disabled={busy || !newNote.trim()}
                        className="w-full"
                      >
                        <MessageSquarePlus className="size-3.5" /> Registrar nota en CRM
                      </Button>
                    </form>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: SAAS PAYMENTS APPROVAL */}
        {activeTab === 'payments' && (
          <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                {(['PENDING', 'APPROVED', 'REJECTED', 'ALL'] as const).map((st) => (
                  <Button
                    key={st}
                    size="sm"
                    variant={paymentFilter === st ? 'default' : 'outline'}
                    onClick={() => setPaymentFilter(st)}
                  >
                    {st}
                  </Button>
                ))}
              </div>
              <Input
                className="max-w-xs"
                placeholder="Motivo opcional en caso de rechazar..."
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
              />
            </div>

            {payments.length === 0 ? (
              <p className="text-sm text-slate-500 py-8 text-center">
                No hay pagos en estado {paymentFilter}.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="text-xs uppercase text-slate-400 border-b border-slate-100">
                    <tr>
                      <th className="py-2.5 pr-4">Fecha</th>
                      <th className="py-2.5 pr-4">Tienda / Dueño</th>
                      <th className="py-2.5 pr-4">Proveedor & Ref.</th>
                      <th className="py-2.5 pr-4">Monto</th>
                      <th className="py-2.5 pr-4">Estado</th>
                      <th className="py-2.5 text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {payments.map((p) => (
                      <tr key={p.id}>
                        <td className="py-3 pr-4 text-slate-600">{formatDate(p.createdAt)}</td>
                        <td className="py-3 pr-4">
                          <p className="font-semibold text-slate-900">
                            {p.subscription.tenant.name}
                          </p>
                          <p className="text-xs text-slate-500">
                            {p.subscription.plan.name} ·{' '}
                            {p.subscription.tenant.owner?.email ?? p.subscription.tenant.slug}
                          </p>
                        </td>
                        <td className="py-3 pr-4">
                          <p className="text-xs font-medium text-slate-800">{p.provider}</p>
                          <p className="text-xs font-mono text-slate-500">
                            {p.externalReference ?? '—'}
                          </p>
                        </td>
                        <td className="py-3 pr-4 font-bold text-slate-900">
                          {formatMoney(p.amount, p.currency)}
                        </td>
                        <td className="py-3 pr-4">
                          <span
                            className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border ${statusBadgeClass(p.reviewStatus)}`}
                          >
                            {p.reviewStatus}
                          </span>
                        </td>
                        <td className="py-3 text-right">
                          {p.reviewStatus === 'PENDING' ? (
                            <div className="inline-flex gap-2">
                              <Button
                                size="xs"
                                disabled={busy}
                                onClick={() => void handleReviewPayment(p.id, 'APPROVED')}
                              >
                                <Check className="size-3" /> Aprobar
                              </Button>
                              <Button
                                size="xs"
                                variant="destructive"
                                disabled={busy}
                                onClick={() => void handleReviewPayment(p.id, 'REJECTED')}
                              >
                                <X className="size-3" /> Rechazar
                              </Button>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">Procesado</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: SAAS PLANS */}
        {activeTab === 'plans' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {plans.map((plan) => (
              <div
                key={plan.id}
                className="bg-white border border-slate-200 rounded-2xl p-6 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-slate-900">{plan.name}</h3>
                  <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-100 text-slate-600">
                    {plan.code}
                  </span>
                </div>
                <p className="text-xs text-slate-500">{plan.description}</p>
                <div className="pt-2 border-t border-slate-100 flex items-baseline gap-3">
                  <span className="text-xl font-bold text-slate-900">
                    {formatMoney(plan.priceMonthly, plan.currency)}/mes
                  </span>
                  <span className="text-xs text-slate-500">
                    ({formatMoney(plan.priceYearly, plan.currency)}/año)
                  </span>
                </div>
                <ul className="text-xs text-slate-700 space-y-1">
                  <li>• Productos máx.: {plan.maxProducts.toLocaleString()}</li>
                  <li>• Staff máx.: {plan.maxStaff}</li>
                  <li>• Dominio propio: {plan.allowCustomDomain ? 'Sí' : 'No'}</li>
                  <li>• CSV masivo: {plan.allowCsvImport ? 'Sí' : 'No'}</li>
                  <li>• Carritos abandonados: {plan.allowAbandonedCart ? 'Sí' : 'No'}</li>
                </ul>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
