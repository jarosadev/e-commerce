'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  Moon,
  Palette,
  Save,
  Settings,
  Sun,
  Upload,
} from 'lucide-react';
import { DashboardNav, type DashboardStoreOption } from '@/components/dashboard/DashboardNav';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import apiClient from '@/lib/api-client';
import { extractErrorMessage } from '@/lib/format';
import { uploadFileViaPresignedUrl } from '@/lib/storage-upload';

interface StoreDetail {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  currency: string;
  whatsappSalesNumber: string | null;
  contactEmail: string | null;
  minWholesaleAmount: number | null;
  minWholesaleQty: number | null;
  stockReservationMins: number;
  theme: {
    logoUrl: string | null;
    faviconUrl: string | null;
    primaryColor: string;
    accentColor: string;
    darkModeDefault: boolean;
    heroTitle: string | null;
    heroSubtitle: string | null;
    announcementText: string | null;
  } | null;
}

export default function DashboardThemePage() {
  const [stores, setStores] = useState<DashboardStoreOption[]>([]);
  const [selectedSlug, setSelectedSlug] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Theme state
  const [logoUrl, setLogoUrl] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#0F172A');
  const [accentColor, setAccentColor] = useState('#4F46E5');
  const [darkModeDefault, setDarkModeDefault] = useState(false);
  const [heroTitle, setHeroTitle] = useState('');
  const [heroSubtitle, setHeroSubtitle] = useState('');
  const [announcementText, setAnnouncementText] = useState('');

  // Store operational & B2B settings
  const [storeName, setStoreName] = useState('');
  const [description, setDescription] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [whatsappSalesNumber, setWhatsappSalesNumber] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [minWholesaleAmount, setMinWholesaleAmount] = useState('');
  const [minWholesaleQty, setMinWholesaleQty] = useState('');
  const [stockReservationMins, setStockReservationMins] = useState('120');

  const loadStore = useCallback(async (slugOverride?: string) => {
    try {
      const storedHost =
        typeof window !== 'undefined' ? sessionStorage.getItem('x-tenant-host') : null;
      const derivedSlug = slugOverride || storedHost?.split('.')[0] || undefined;
      const headers: Record<string, string> = {};
      if (derivedSlug) headers['x-tenant-slug'] = derivedSlug;

      const [storesRes, detailRes] = await Promise.all([
        apiClient.get<DashboardStoreOption[]>('/tenants'),
        apiClient.get<StoreDetail>('/tenants/current', { headers }),
      ]);

      const store = detailRes.data;
      setStores(storesRes.data);
      setSelectedSlug(store.slug);
      setError(null);

      setStoreName(store.name);
      setDescription(store.description ?? '');
      setCurrency(store.currency);
      setWhatsappSalesNumber(store.whatsappSalesNumber ?? '');
      setContactEmail(store.contactEmail ?? '');
      setMinWholesaleAmount(
        store.minWholesaleAmount !== null ? String(store.minWholesaleAmount) : '',
      );
      setMinWholesaleQty(store.minWholesaleQty !== null ? String(store.minWholesaleQty) : '');
      setStockReservationMins(String(store.stockReservationMins ?? 120));

      setLogoUrl(store.theme?.logoUrl ?? '');
      setPrimaryColor(store.theme?.primaryColor ?? '#0F172A');
      setAccentColor(store.theme?.accentColor ?? '#4F46E5');
      setDarkModeDefault(Boolean(store.theme?.darkModeDefault));
      setHeroTitle(store.theme?.heroTitle ?? '');
      setHeroSubtitle(store.theme?.heroSubtitle ?? '');
      setAnnouncementText(store.theme?.announcementText ?? '');
    } catch (err) {
      setError(extractErrorMessage(err, 'No se pudo cargar la configuración de tu tienda.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const run = async () => {
      if (active) await loadStore();
    };
    void run();
    return () => {
      active = false;
    };
  }, [loadStore]);

  const handleSelectStore = (slug: string) => {
    setSelectedSlug(slug);
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('x-tenant-host', `${slug}.localhost:3000`);
    }
    void loadStore(slug);
  };

  const handleLogoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedSlug) return;
    setUploadingLogo(true);
    setError(null);
    setFeedback(null);
    try {
      const uploaded = await uploadFileViaPresignedUrl(selectedSlug, 'branding', file);
      if (uploaded.publicUrl) {
        setLogoUrl(uploaded.publicUrl);
        setFeedback('Logo subido a S3 correctamente. Guarda el tema para publicarlo.');
      }
    } catch (err) {
      setError(extractErrorMessage(err, 'No se pudo subir el logo.'));
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleSaveTheme = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSlug) return;
    setSaving(true);
    setError(null);
    setFeedback(null);
    try {
      await apiClient.patch(
        '/tenants/current/theme',
        {
          logoUrl: logoUrl.trim() || null,
          primaryColor,
          accentColor,
          darkModeDefault,
          heroTitle: heroTitle.trim() || null,
          heroSubtitle: heroSubtitle.trim() || null,
          announcementText: announcementText.trim() || null,
        },
        { headers: { 'x-tenant-slug': selectedSlug } },
      );
      setFeedback('Tema visual guardado e invalidado en caché Redis.');
    } catch (err) {
      setError(extractErrorMessage(err, 'No se pudo guardar el tema.'));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSlug) return;
    setSaving(true);
    setError(null);
    setFeedback(null);
    try {
      await apiClient.patch(
        '/tenants/current/settings',
        {
          name: storeName.trim(),
          description: description.trim() || null,
          currency: currency.trim().toUpperCase(),
          whatsappSalesNumber: whatsappSalesNumber.trim() || null,
          contactEmail: contactEmail.trim() || null,
          minWholesaleAmount: minWholesaleAmount ? Number(minWholesaleAmount) : null,
          minWholesaleQty: minWholesaleQty ? Number(minWholesaleQty) : null,
          stockReservationMins: Number(stockReservationMins) || 120,
        },
        { headers: { 'x-tenant-slug': selectedSlug } },
      );
      setFeedback('Ajustes operativos y reglas B2B actualizados correctamente.');
    } catch (err) {
      setError(extractErrorMessage(err, 'No se pudieron guardar los ajustes de tienda.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <DashboardNav
        stores={stores}
        selectedSlug={selectedSlug}
        onSelectStore={handleSelectStore}
        onRefresh={() => void loadStore(selectedSlug)}
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

        {loading ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center text-sm text-slate-500">
            Cargando editor visual de tienda...
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Formularios izquierda */}
            <div className="lg:col-span-7 space-y-6">
              <form
                onSubmit={handleSaveTheme}
                className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5"
              >
                <div className="flex items-center gap-2 font-bold text-slate-900">
                  <Palette className="size-5 text-indigo-600" />
                  <h2>Personalizador Visual de Marca</h2>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-700">Logo de la tienda</label>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      className="flex-1 min-w-52"
                      placeholder="https://... o sube archivo a S3"
                      value={logoUrl}
                      onChange={(e) => setLogoUrl(e.target.value)}
                    />
                    <label className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-slate-700 cursor-pointer">
                      <Upload className="size-3.5" />
                      {uploadingLogo ? 'Subiendo...' : 'Subir Logo'}
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/svg+xml"
                        className="hidden"
                        disabled={uploadingLogo}
                        onChange={(e) => void handleLogoFileChange(e)}
                      />
                    </label>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-700">Color Primario</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={primaryColor}
                        onChange={(e) => setPrimaryColor(e.target.value)}
                        className="h-9 w-11 rounded border border-slate-200 cursor-pointer"
                      />
                      <Input
                        value={primaryColor}
                        onChange={(e) => setPrimaryColor(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-700">Color Acento</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={accentColor}
                        onChange={(e) => setAccentColor(e.target.value)}
                        className="h-9 w-11 rounded border border-slate-200 cursor-pointer"
                      />
                      <Input
                        value={accentColor}
                        onChange={(e) => setAccentColor(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-700">Modo por defecto</label>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setDarkModeDefault((prev) => !prev)}
                      className="w-full h-9"
                    >
                      {darkModeDefault ? (
                        <>
                          <Moon className="size-4" /> Modo Oscuro
                        </>
                      ) : (
                        <>
                          <Sun className="size-4" /> Modo Claro
                        </>
                      )}
                    </Button>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-700">
                      Barra superior de anuncio
                    </label>
                    <Input
                      placeholder="Envío gratis desde $120 · Descuentos mayoristas automáticos"
                      value={announcementText}
                      onChange={(e) => setAnnouncementText(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-700">Título Hero</label>
                    <Input
                      placeholder="Colección 2026 Minorista & Mayorista"
                      value={heroTitle}
                      onChange={(e) => setHeroTitle(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-700">Subtítulo Hero</label>
                    <Input
                      placeholder="Combina variantes y obtén precios por volumen al instante."
                      value={heroSubtitle}
                      onChange={(e) => setHeroSubtitle(e.target.value)}
                    />
                  </div>
                </div>

                <Button type="submit" disabled={saving}>
                  <Save className="size-4" /> Guardar Diseño Visual
                </Button>
              </form>

              <form
                onSubmit={handleSaveSettings}
                className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5"
              >
                <div className="flex items-center gap-2 font-bold text-slate-900">
                  <Settings className="size-5 text-slate-700" />
                  <h2>Configuración Operativa & Reglas Mayoristas B2B</h2>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-700">Nombre comercial</label>
                    <Input value={storeName} onChange={(e) => setStoreName(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-700">Moneda (ISO 3)</label>
                    <Input
                      maxLength={3}
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-700">
                      WhatsApp de ventas B2B
                    </label>
                    <Input
                      placeholder="5491145550199"
                      value={whatsappSalesNumber}
                      onChange={(e) => setWhatsappSalesNumber(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-700">Email de contacto</label>
                    <Input
                      type="email"
                      value={contactEmail}
                      onChange={(e) => setContactEmail(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-700">
                      Compra mínima mayorista ({currency})
                    </label>
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="120"
                      value={minWholesaleAmount}
                      onChange={(e) => setMinWholesaleAmount(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-700">
                      Cantidad mínima mayorista (uds.)
                    </label>
                    <Input
                      type="number"
                      placeholder="6"
                      value={minWholesaleQty}
                      onChange={(e) => setMinWholesaleQty(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <label className="text-xs font-medium text-slate-700">
                      Tiempo de reserva de stock en pedidos pendientes (minutos)
                    </label>
                    <Input
                      type="number"
                      min={15}
                      value={stockReservationMins}
                      onChange={(e) => setStockReservationMins(e.target.value)}
                    />
                  </div>
                </div>

                <Button type="submit" variant="secondary" disabled={saving}>
                  <Save className="size-4" /> Guardar Reglas Operativas
                </Button>
              </form>
            </div>

            {/* Vista Previa en Vivo derecha */}
            <div className="lg:col-span-5">
              <div className="sticky top-32 space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Vista previa en vivo del Storefront
                </p>
                <div
                  className={`rounded-2xl border overflow-hidden shadow-md transition-colors ${
                    darkModeDefault
                      ? 'bg-slate-950 text-white border-slate-800'
                      : 'bg-white text-slate-900 border-slate-200'
                  }`}
                >
                  {announcementText && (
                    <div
                      className="px-4 py-1.5 text-center text-[11px] font-medium text-white"
                      style={{ backgroundColor: accentColor }}
                    >
                      {announcementText}
                    </div>
                  )}
                  <div
                    className="px-5 py-3.5 text-white flex items-center justify-between"
                    style={{ backgroundColor: primaryColor }}
                  >
                    <div className="flex items-center gap-2">
                      {logoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={logoUrl}
                          alt={storeName}
                          className="h-7 w-auto rounded bg-white/90 p-0.5 object-contain"
                        />
                      ) : (
                        <span className="font-bold text-sm">{storeName || 'Tu Tienda'}</span>
                      )}
                    </div>
                    <span
                      className="px-3 py-1 rounded-full text-[11px] font-semibold text-white"
                      style={{ backgroundColor: accentColor }}
                    >
                      Carrito (2)
                    </span>
                  </div>

                  <div className="p-6 space-y-4">
                    <div className="space-y-1.5">
                      <h3 className="text-lg font-bold leading-snug">
                        {heroTitle || storeName || 'Colección Destacada'}
                      </h3>
                      <p
                        className={`text-xs ${darkModeDefault ? 'text-slate-400' : 'text-slate-500'}`}
                      >
                        {heroSubtitle || 'Venta minorista y mayorista con envíos a todo el país.'}
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      {['Hoodie Boxy 450gsm', 'Sneaker Court'].map((item, idx) => (
                        <div
                          key={item}
                          className={`rounded-xl border p-3 space-y-2 ${
                            darkModeDefault
                              ? 'bg-slate-900 border-slate-800'
                              : 'bg-slate-50 border-slate-200'
                          }`}
                        >
                          <div className="h-20 rounded-lg bg-slate-200/40" />
                          <p className="text-xs font-semibold truncate">{item}</p>
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold">
                              {idx === 0 ? '42.00' : '68.00'} {currency}
                            </span>
                            <span
                              className="text-[10px] font-semibold px-2 py-0.5 rounded text-white"
                              style={{ backgroundColor: accentColor }}
                            >
                              B2B -30%
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
