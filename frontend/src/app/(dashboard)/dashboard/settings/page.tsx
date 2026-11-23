'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  Landmark,
  Plus,
  Search,
  Trash2,
  Truck,
  Users,
} from 'lucide-react';
import { DashboardNav, type DashboardStoreOption } from '@/components/dashboard/DashboardNav';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import apiClient from '@/lib/api-client';
import { extractErrorMessage, formatMoney } from '@/lib/format';

interface PaymentMethodItem {
  id: string;
  type: 'BANK_TRANSFER' | 'QR_CODE' | 'MOBILE_PAYMENT' | 'CASH_ON_DELIVERY' | 'WHATSAPP_B2B';
  title: string;
  instructions: string | null;
  accountDetailsJson: Record<string, string> | null;
  requiresReceipt: boolean;
  isActive: boolean;
}

interface ShippingZoneItem {
  id: string;
  name: string;
  cities: string[];
  flatRate: number;
  freeShippingThreshold: number | null;
  isLocalPickup: boolean;
  pickupAddress: string | null;
  estimatedDays: string | null;
  isActive: boolean;
}

interface StoreCustomerItem {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  taxId: string | null;
  customerTier: 'RETAIL' | 'WHOLESALE_B2B';
  totalOrders: number;
  totalSpent: number;
}

export default function DashboardSettingsPage() {
  const [stores, setStores] = useState<DashboardStoreOption[]>([]);
  const [selectedSlug, setSelectedSlug] = useState('');
  const [activeTab, setActiveTab] = useState<'payments' | 'shipping' | 'customers'>('payments');

  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodItem[]>([]);
  const [shippingZones, setShippingZones] = useState<ShippingZoneItem[]>([]);
  const [customers, setCustomers] = useState<StoreCustomerItem[]>([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerTierFilter, setCustomerTierFilter] = useState('');

  // New Payment Method form
  const [pmType, setPmType] = useState<PaymentMethodItem['type']>('BANK_TRANSFER');
  const [pmTitle, setPmTitle] = useState('');
  const [pmBank, setPmBank] = useState('');
  const [pmAlias, setPmAlias] = useState('');
  const [pmInstructions, setPmInstructions] = useState('');

  // New Shipping Zone form
  const [szName, setSzName] = useState('');
  const [szCities, setSzCities] = useState('');
  const [szRate, setSzRate] = useState('0');
  const [szFreeAbove, setSzFreeAbove] = useState('');
  const [szPickup, setSzPickup] = useState(false);
  const [szPickupAddr, setSzPickupAddr] = useState('');
  const [szEstimated, setSzEstimated] = useState('24 a 48 hs');

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const loadAll = useCallback(
    async (slugOverride?: string) => {
      try {
        const storedHost =
          typeof window !== 'undefined' ? sessionStorage.getItem('x-tenant-host') : null;
        const storesRes = await apiClient.get<DashboardStoreOption[]>('/tenants');
        const activeSlug =
          slugOverride || storedHost?.split('.')[0] || storesRes.data[0]?.slug || '';
        setStores(storesRes.data);
        setSelectedSlug(activeSlug);

        if (!activeSlug) {
          setLoading(false);
          return;
        }

        const headers = { 'x-tenant-slug': activeSlug };
        const [pmRes, szRes, custRes] = await Promise.all([
          apiClient.get<PaymentMethodItem[]>('/store-ops/payment-methods', { headers }),
          apiClient.get<ShippingZoneItem[]>('/store-ops/shipping-zones', { headers }),
          apiClient.get<{ items: StoreCustomerItem[] }>('/store-ops/customers', {
            headers,
            params: {
              search: customerSearch.trim() || undefined,
              customerTier: customerTierFilter || undefined,
            },
          }),
        ]);

        setPaymentMethods(pmRes.data);
        setShippingZones(szRes.data);
        setCustomers(custRes.data.items ?? []);
        setError(null);
      } catch (err) {
        setError(extractErrorMessage(err, 'No se pudo cargar la configuración operativa.'));
      } finally {
        setLoading(false);
      }
    },
    [customerSearch, customerTierFilter],
  );

  useEffect(() => {
    let active = true;
    const run = async () => {
      if (active) await loadAll();
    };
    void run();
    return () => {
      active = false;
    };
  }, [loadAll]);

  const handleSelectStore = (slug: string) => {
    setSelectedSlug(slug);
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('x-tenant-host', `${slug}.localhost:3000`);
    }
    void loadAll(slug);
  };

  const handleCreatePaymentMethod = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSlug || !pmTitle.trim()) return;
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      await apiClient.post(
        '/store-ops/payment-methods',
        {
          type: pmType,
          title: pmTitle.trim(),
          instructions: pmInstructions.trim() || null,
          accountDetailsJson:
            pmBank.trim() || pmAlias.trim()
              ? { banco: pmBank.trim(), alias: pmAlias.trim() }
              : null,
          requiresReceipt: pmType !== 'CASH_ON_DELIVERY',
        },
        { headers: { 'x-tenant-slug': selectedSlug } },
      );
      setPmTitle('');
      setPmBank('');
      setPmAlias('');
      setPmInstructions('');
      setFeedback('Método de pago manual agregado a tu tienda.');
      await loadAll(selectedSlug);
    } catch (err) {
      setError(extractErrorMessage(err, 'No se pudo crear el método de pago.'));
    } finally {
      setBusy(false);
    }
  };

  const handleDeletePaymentMethod = async (id: string) => {
    if (!selectedSlug) return;
    setBusy(true);
    try {
      await apiClient.delete(`/store-ops/payment-methods/${id}`, {
        headers: { 'x-tenant-slug': selectedSlug },
      });
      setFeedback('Método de pago eliminado.');
      await loadAll(selectedSlug);
    } catch (err) {
      setError(extractErrorMessage(err, 'No se pudo eliminar el método de pago.'));
    } finally {
      setBusy(false);
    }
  };

  const handleCreateShippingZone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSlug || !szName.trim()) return;
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      await apiClient.post(
        '/store-ops/shipping-zones',
        {
          name: szName.trim(),
          cities: szCities
            .split(',')
            .map((c) => c.trim())
            .filter(Boolean),
          flatRate: szPickup ? 0 : Number(szRate) || 0,
          freeShippingThreshold: szFreeAbove ? Number(szFreeAbove) : null,
          isLocalPickup: szPickup,
          pickupAddress: szPickup ? szPickupAddr.trim() || null : null,
          estimatedDays: szEstimated.trim() || null,
        },
        { headers: { 'x-tenant-slug': selectedSlug } },
      );
      setSzName('');
      setSzCities('');
      setSzRate('0');
      setSzFreeAbove('');
      setSzPickupAddr('');
      setFeedback('Zona de envío / sucursal agregada correctamente.');
      await loadAll(selectedSlug);
    } catch (err) {
      setError(extractErrorMessage(err, 'No se pudo crear la zona de envío.'));
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteShippingZone = async (id: string) => {
    if (!selectedSlug) return;
    setBusy(true);
    try {
      await apiClient.delete(`/store-ops/shipping-zones/${id}`, {
        headers: { 'x-tenant-slug': selectedSlug },
      });
      setFeedback('Zona de envío eliminada.');
      await loadAll(selectedSlug);
    } catch (err) {
      setError(extractErrorMessage(err, 'No se pudo eliminar la zona de envío.'));
    } finally {
      setBusy(false);
    }
  };

  const handleToggleCustomerTier = async (customer: StoreCustomerItem) => {
    if (!selectedSlug) return;
    setBusy(true);
    setError(null);
    const nextTier = customer.customerTier === 'WHOLESALE_B2B' ? 'RETAIL' : 'WHOLESALE_B2B';
    try {
      await apiClient.patch(
        `/store-ops/customers/${customer.id}/tier`,
        { customerTier: nextTier },
        { headers: { 'x-tenant-slug': selectedSlug } },
      );
      setFeedback(`Cliente ${customer.fullName} actualizado a ${nextTier}.`);
      await loadAll(selectedSlug);
    } catch (err) {
      setError(extractErrorMessage(err, 'No se pudo actualizar el nivel del comprador.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <DashboardNav
        stores={stores}
        selectedSlug={selectedSlug}
        onSelectStore={handleSelectStore}
        onRefresh={() => void loadAll(selectedSlug)}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        )}
        {feedback && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 flex items-center gap-2">
            <CheckCircle2 className="size-4 shrink-0" />
            <span>{feedback}</span>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {[
            { id: 'payments', label: `Pagos Manuales (${paymentMethods.length})`, icon: Landmark },
            { id: 'shipping', label: `Zonas de Envío (${shippingZones.length})`, icon: Truck },
            { id: 'customers', label: `Compradores B2C / B2B (${customers.length})`, icon: Users },
          ].map((tab) => {
            const Icon = tab.icon;
            return (
              <Button
                key={tab.id}
                size="sm"
                variant={activeTab === tab.id ? 'default' : 'outline'}
                onClick={() => setActiveTab(tab.id as 'payments' | 'shipping' | 'customers')}
              >
                <Icon className="size-4" /> {tab.label}
              </Button>
            );
          })}
        </div>

        {loading ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center text-sm text-slate-500">
            Cargando configuración operativa...
          </div>
        ) : (
          <>
            {activeTab === 'payments' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <form
                  onSubmit={handleCreatePaymentMethod}
                  className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-6 space-y-4 h-fit"
                >
                  <h2 className="font-bold text-slate-900">Agregar Método de Pago Manual</h2>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-700">Tipo</label>
                    <select
                      value={pmType}
                      onChange={(e) => setPmType(e.target.value as PaymentMethodItem['type'])}
                      className="w-full h-9 rounded-lg border border-slate-200 px-3 text-sm bg-white"
                    >
                      <option value="BANK_TRANSFER">Transferencia Bancaria</option>
                      <option value="QR_CODE">Pago con QR</option>
                      <option value="MOBILE_PAYMENT">Pago Móvil</option>
                      <option value="CASH_ON_DELIVERY">Efectivo / Contraentrega</option>
                      <option value="WHATSAPP_B2B">Acuerdo Mayorista WhatsApp</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-700">Título visible *</label>
                    <Input
                      required
                      placeholder="Ej. Transferencia Banco Galicia"
                      value={pmTitle}
                      onChange={(e) => setPmTitle(e.target.value)}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Input
                      placeholder="Banco / Entidad"
                      value={pmBank}
                      onChange={(e) => setPmBank(e.target.value)}
                    />
                    <Input
                      placeholder="Alias / CBU / Cuenta"
                      value={pmAlias}
                      onChange={(e) => setPmAlias(e.target.value)}
                    />
                  </div>
                  <Input
                    placeholder="Instrucciones para el comprador..."
                    value={pmInstructions}
                    onChange={(e) => setPmInstructions(e.target.value)}
                  />
                  <Button type="submit" disabled={busy} className="w-full">
                    <Plus className="size-4" /> Guardar Método de Pago
                  </Button>
                </form>

                <div className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl divide-y divide-slate-100">
                  {paymentMethods.length === 0 ? (
                    <p className="p-8 text-center text-sm text-slate-500">
                      No hay métodos de pago configurados aún.
                    </p>
                  ) : (
                    paymentMethods.map((m) => (
                      <div key={m.id} className="p-4 flex items-start justify-between gap-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm text-slate-900">{m.title}</span>
                            <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-100 text-slate-600">
                              {m.type}
                            </span>
                          </div>
                          {m.instructions && (
                            <p className="text-xs text-slate-500">{m.instructions}</p>
                          )}
                          {m.accountDetailsJson && (
                            <p className="text-xs font-mono text-slate-600">
                              {Object.entries(m.accountDetailsJson)
                                .filter(([, v]) => Boolean(v))
                                .map(([k, v]) => `${k}: ${v}`)
                                .join(' · ')}
                            </p>
                          )}
                        </div>
                        <Button
                          size="xs"
                          variant="destructive"
                          disabled={busy}
                          onClick={() => void handleDeletePaymentMethod(m.id)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {activeTab === 'shipping' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <form
                  onSubmit={handleCreateShippingZone}
                  className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-6 space-y-4 h-fit"
                >
                  <h2 className="font-bold text-slate-900">Agregar Zona de Envío o Retiro</h2>
                  <Input
                    required
                    placeholder="Nombre (ej. Envío Express CABA)"
                    value={szName}
                    onChange={(e) => setSzName(e.target.value)}
                  />
                  <Input
                    placeholder="Ciudades separadas por coma (CABA, Rosario, Córdoba)"
                    value={szCities}
                    onChange={(e) => setSzCities(e.target.value)}
                  />
                  <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={szPickup}
                      onChange={(e) => setSzPickup(e.target.checked)}
                    />
                    Es punto de retiro gratis en local / showroom
                  </label>
                  {szPickup ? (
                    <Input
                      placeholder="Dirección de retiro y horarios"
                      value={szPickupAddr}
                      onChange={(e) => setSzPickupAddr(e.target.value)}
                    />
                  ) : (
                    <div className="grid grid-cols-2 gap-3">
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="Tarifa fija (USD)"
                        value={szRate}
                        onChange={(e) => setSzRate(e.target.value)}
                      />
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="Gratis desde (opcional)"
                        value={szFreeAbove}
                        onChange={(e) => setSzFreeAbove(e.target.value)}
                      />
                    </div>
                  )}
                  <Input
                    placeholder="Tiempo estimado (ej. 24 a 48 hs)"
                    value={szEstimated}
                    onChange={(e) => setSzEstimated(e.target.value)}
                  />
                  <Button type="submit" disabled={busy} className="w-full">
                    <Plus className="size-4" /> Guardar Zona
                  </Button>
                </form>

                <div className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl divide-y divide-slate-100">
                  {shippingZones.length === 0 ? (
                    <p className="p-8 text-center text-sm text-slate-500">
                      No hay zonas de envío configuradas aún.
                    </p>
                  ) : (
                    shippingZones.map((z) => (
                      <div key={z.id} className="p-4 flex items-start justify-between gap-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm text-slate-900">{z.name}</span>
                            <span className="text-xs font-bold text-indigo-700">
                              {z.isLocalPickup ? 'Retiro Gratis' : formatMoney(z.flatRate)}
                            </span>
                          </div>
                          {z.cities.length > 0 && (
                            <p className="text-xs text-slate-500">
                              Cobertura: {z.cities.join(', ')}
                            </p>
                          )}
                          {z.freeShippingThreshold !== null && (
                            <p className="text-xs text-emerald-700 font-medium">
                              Envío gratis desde {formatMoney(z.freeShippingThreshold)}
                            </p>
                          )}
                          {z.pickupAddress && (
                            <p className="text-xs text-slate-600">Dirección: {z.pickupAddress}</p>
                          )}
                        </div>
                        <Button
                          size="xs"
                          variant="destructive"
                          disabled={busy}
                          onClick={() => void handleDeleteShippingZone(z.id)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {activeTab === 'customers' && (
              <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
                <div className="flex flex-wrap gap-3">
                  <div className="relative flex-1 min-w-52">
                    <Search className="size-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <Input
                      className="pl-9"
                      placeholder="Buscar comprador por nombre, email o teléfono..."
                      value={customerSearch}
                      onChange={(e) => setCustomerSearch(e.target.value)}
                    />
                  </div>
                  <select
                    value={customerTierFilter}
                    onChange={(e) => setCustomerTierFilter(e.target.value)}
                    className="h-9 rounded-lg border border-slate-200 px-3 text-xs font-medium bg-white"
                  >
                    <option value="">Todos los segmentos</option>
                    <option value="RETAIL">Minorista (RETAIL)</option>
                    <option value="WHOLESALE_B2B">Mayorista (WHOLESALE_B2B)</option>
                  </select>
                </div>

                {customers.length === 0 ? (
                  <p className="py-8 text-center text-sm text-slate-500">
                    Aún no hay compradores registrados en esta tienda.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                      <thead className="text-xs uppercase text-slate-400 border-b border-slate-100">
                        <tr>
                          <th className="py-2.5 pr-4">Comprador</th>
                          <th className="py-2.5 pr-4">Contacto</th>
                          <th className="py-2.5 pr-4">Segmento</th>
                          <th className="py-2.5 pr-4">Pedidos / Gastado</th>
                          <th className="py-2.5 text-right">Acción B2B</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {customers.map((c) => (
                          <tr key={c.id}>
                            <td className="py-3 pr-4">
                              <p className="font-semibold text-slate-900">{c.fullName}</p>
                              <p className="text-xs text-slate-500">{c.email}</p>
                            </td>
                            <td className="py-3 pr-4 text-xs text-slate-600">
                              {c.phone || '—'} {c.taxId ? `· ${c.taxId}` : ''}
                            </td>
                            <td className="py-3 pr-4">
                              <span
                                className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border ${
                                  c.customerTier === 'WHOLESALE_B2B'
                                    ? 'bg-indigo-100 text-indigo-800 border-indigo-200'
                                    : 'bg-slate-100 text-slate-700 border-slate-200'
                                }`}
                              >
                                {c.customerTier}
                              </span>
                            </td>
                            <td className="py-3 pr-4 text-xs text-slate-700">
                              {c.totalOrders} pedidos · {formatMoney(c.totalSpent)}
                            </td>
                            <td className="py-3 text-right">
                              <Button
                                size="xs"
                                variant="outline"
                                disabled={busy}
                                onClick={() => void handleToggleCustomerTier(c)}
                              >
                                {c.customerTier === 'WHOLESALE_B2B'
                                  ? 'Pasar a Minorista'
                                  : 'Promover a Mayorista B2B'}
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
