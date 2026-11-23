'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Globe,
  Palette,
  Sparkles,
  Store,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import apiClient from '@/lib/api-client';
import { extractErrorMessage, formatMoney } from '@/lib/format';

interface PlanOption {
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

export default function StoreOnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [plans, setPlans] = useState<PlanOption[]>([]);

  // Paso 1: Datos comerciales y fiscales
  const [storeName, setStoreName] = useState('');
  const [legalName, setLegalName] = useState('');
  const [taxId, setTaxId] = useState('');
  const [whatsappSalesNumber, setWhatsappSalesNumber] = useState('');
  const [country, setCountry] = useState('Argentina');
  const [city, setCity] = useState('');

  // Paso 2: Subdominio en tiempo real
  const [slug, setSlug] = useState('');
  const [slugChecking, setSlugChecking] = useState(false);
  const [slugAvailable, setSlugAvailable] = useState<boolean | null>(null);
  const [slugReason, setSlugReason] = useState<string | null>(null);

  // Paso 3: Branding y plan
  const [primaryColor, setPrimaryColor] = useState('#0F172A');
  const [accentColor, setAccentColor] = useState('#4F46E5');
  const [heroTitle, setHeroTitle] = useState('');
  const [selectedPlanCode, setSelectedPlanCode] = useState('EMPRENDEDOR');
  const [billingCycle, setBillingCycle] = useState<'MONTHLY' | 'YEARLY'>('MONTHLY');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .get<PlanOption[]>('/plans')
      .then((res) => {
        if (Array.isArray(res.data) && res.data.length > 0) {
          setPlans(res.data);
          setSelectedPlanCode(res.data[0].code);
        }
      })
      .catch(() => {
        // Plans will still allow fallback code
      });
  }, []);

  useEffect(() => {
    const clean = slug.trim().toLowerCase();
    if (clean.length < 3) {
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setSlugChecking(true);
      try {
        const res = await apiClient.get<{
          slug: string;
          available: boolean;
          reason?: string | null;
        }>('/tenants/check-slug', { params: { slug: clean } });
        if (!cancelled) {
          setSlugAvailable(res.data.available);
          setSlugReason(res.data.reason ?? null);
        }
      } catch {
        if (!cancelled) {
          setSlugAvailable(null);
          setSlugReason('No se pudo verificar disponibilidad.');
        }
      } finally {
        if (!cancelled) {
          setSlugChecking(false);
        }
      }
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [slug]);

  const handleSlugInputChange = (raw: string) => {
    const next = raw.toLowerCase().replace(/[^a-z0-9-]/g, '');
    setSlug(next);
    if (next.length < 3) {
      setSlugAvailable(null);
      setSlugReason(next.length > 0 ? 'Ingresa al menos 3 caracteres.' : null);
    }
  };

  const handleStoreNameChange = (value: string) => {
    setStoreName(value);
    if (!slug) {
      const suggested = value
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);
      if (suggested.length >= 3) {
        setSlug(suggested);
      }
    }
  };

  const handleSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const res = await apiClient.post<{ slug: string }>('/tenants', {
        name: storeName.trim(),
        slug: slug.trim().toLowerCase(),
        legalName: legalName.trim() || undefined,
        taxId: taxId.trim() || undefined,
        whatsappSalesNumber: whatsappSalesNumber.trim() || undefined,
        country: country.trim() || undefined,
        city: city.trim() || undefined,
        primaryColor,
        accentColor,
        heroTitle: heroTitle.trim() || storeName.trim(),
        planCode: selectedPlanCode,
        billingCycle,
      });
      if (typeof window !== 'undefined' && res.data?.slug) {
        sessionStorage.setItem('x-tenant-host', `${res.data.slug}.localhost:3000`);
      }
      router.push('/dashboard');
    } catch (err) {
      setError(extractErrorMessage(err, 'No se pudo crear la tienda. Revisa los datos.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 py-10 px-4">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-900 mb-2"
            >
              <ArrowLeft className="size-3.5" /> Volver al Dashboard
            </Link>
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <Sparkles className="size-6 text-indigo-600" />
              Crea tu tienda online en 3 pasos
            </h1>
            <p className="text-sm text-slate-500">
              Inicia con 14 días de prueba gratis con catálogo minorista B2C y mayorista B2B.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs font-semibold">
            {[1, 2, 3].map((n) => (
              <span
                key={n}
                className={`size-8 rounded-full flex items-center justify-center border ${
                  step === n
                    ? 'bg-slate-900 text-white border-slate-900'
                    : step > n
                      ? 'bg-emerald-600 text-white border-emerald-600'
                      : 'bg-white text-slate-400 border-slate-200'
                }`}
              >
                {n}
              </span>
            ))}
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        )}

        <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-sm space-y-6">
          {step === 1 && (
            <div className="space-y-5">
              <div className="flex items-center gap-2 text-slate-900 font-semibold">
                <Store className="size-5 text-indigo-600" />
                <span>Paso 1: Datos comerciales y ficha fiscal</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5 sm:col-span-2">
                  <label className="text-xs font-medium text-slate-700">
                    Nombre comercial de la tienda *
                  </label>
                  <Input
                    placeholder="Ej. Calzados Norte B2B"
                    value={storeName}
                    onChange={(e) => handleStoreNameChange(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-700">
                    Razón social / Titular
                  </label>
                  <Input
                    placeholder="Calzados Norte S.R.L."
                    value={legalName}
                    onChange={(e) => setLegalName(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-700">
                    Identificación fiscal (RUC / DNI / CUIT)
                  </label>
                  <Input
                    placeholder="20-12345678-9"
                    value={taxId}
                    onChange={(e) => setTaxId(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-700">
                    WhatsApp de ventas (para checkout B2B)
                  </label>
                  <Input
                    placeholder="+5491145550199"
                    value={whatsappSalesNumber}
                    onChange={(e) => setWhatsappSalesNumber(e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-700">País</label>
                    <Input value={country} onChange={(e) => setCountry(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-700">Ciudad</label>
                    <Input
                      placeholder="Buenos Aires"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                    />
                  </div>
                </div>
              </div>
              <div className="flex justify-end pt-2">
                <Button
                  type="button"
                  disabled={storeName.trim().length < 2}
                  onClick={() => setStep(2)}
                >
                  Siguiente: Subdominio <ArrowRight className="size-4" />
                </Button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <div className="flex items-center gap-2 text-slate-900 font-semibold">
                <Globe className="size-5 text-indigo-600" />
                <span>Paso 2: Elige el subdominio de tu tienda</span>
              </div>
              <p className="text-sm text-slate-500">
                Tu tienda quedará publicada inmediatamente en este enlace. En planes Pro y
                Enterprise luego podrás conectar tu propio dominio (www.tumarca.com).
              </p>

              <div className="space-y-2">
                <label className="text-xs font-medium text-slate-700">Subdominio único *</label>
                <div className="flex items-center gap-2">
                  <Input
                    value={slug}
                    onChange={(e) => handleSlugInputChange(e.target.value)}
                    placeholder="mi-tienda-pro"
                  />
                  <span className="text-sm text-slate-500 font-mono whitespace-nowrap">
                    .vendexa.app
                  </span>
                </div>

                <div className="min-h-6 flex items-center gap-2 text-xs">
                  {slugChecking && (
                    <span className="text-slate-500">Verificando disponibilidad...</span>
                  )}
                  {!slugChecking && slugAvailable === true && (
                    <span className="text-emerald-700 font-medium inline-flex items-center gap-1">
                      <CheckCircle2 className="size-4" /> ¡Disponible! Tu URL será{' '}
                      <strong>{slug}.vendexa.app</strong>
                    </span>
                  )}
                  {!slugChecking && slugAvailable === false && (
                    <span className="text-rose-600 font-medium inline-flex items-center gap-1">
                      <XCircle className="size-4" /> {slugReason ?? 'Subdominio no disponible.'}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex justify-between pt-2">
                <Button type="button" variant="outline" onClick={() => setStep(1)}>
                  <ArrowLeft className="size-4" /> Atrás
                </Button>
                <Button
                  type="button"
                  disabled={slugChecking || slugAvailable !== true}
                  onClick={() => setStep(3)}
                >
                  Siguiente: Diseño y Plan <ArrowRight className="size-4" />
                </Button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6">
              <div className="flex items-center gap-2 text-slate-900 font-semibold">
                <Palette className="size-5 text-indigo-600" />
                <span>Paso 3: Identidad visual y Plan SaaS</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-700">Color primario</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={primaryColor}
                      onChange={(e) => setPrimaryColor(e.target.value)}
                      className="h-9 w-12 rounded border border-slate-200 cursor-pointer"
                    />
                    <Input value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-700">Color de acento</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={accentColor}
                      onChange={(e) => setAccentColor(e.target.value)}
                      className="h-9 w-12 rounded border border-slate-200 cursor-pointer"
                    />
                    <Input value={accentColor} onChange={(e) => setAccentColor(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-700">Titular portada</label>
                  <Input
                    placeholder={storeName || 'Bienvenido a nuestra tienda'}
                    value={heroTitle}
                    onChange={(e) => setHeroTitle(e.target.value)}
                  />
                </div>
              </div>

              {/* Mini vista previa en vivo */}
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <div
                  className="px-4 py-3 text-white flex items-center justify-between text-xs font-semibold"
                  style={{ backgroundColor: primaryColor }}
                >
                  <span>{storeName || 'Tu Tienda'}</span>
                  <span
                    className="px-2.5 py-1 rounded-full text-white"
                    style={{ backgroundColor: accentColor }}
                  >
                    Carrito (0)
                  </span>
                </div>
                <div className="p-4 bg-slate-50">
                  <p className="text-sm font-bold text-slate-900">
                    {heroTitle || storeName || 'Tu nueva tienda online'}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    https://{slug || 'tu-tienda'}.vendexa.app
                  </p>
                </div>
              </div>

              {/* Selector de ciclo y planes */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Selecciona tu plan (14 días de prueba incluidos)
                  </span>
                  <div className="inline-flex rounded-lg border border-slate-200 p-0.5 bg-slate-100 text-xs">
                    <button
                      type="button"
                      onClick={() => setBillingCycle('MONTHLY')}
                      className={`px-3 py-1 rounded-md font-medium ${
                        billingCycle === 'MONTHLY' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-600'
                      }`}
                    >
                      Mensual
                    </button>
                    <button
                      type="button"
                      onClick={() => setBillingCycle('YEARLY')}
                      className={`px-3 py-1 rounded-md font-medium ${
                        billingCycle === 'YEARLY' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-600'
                      }`}
                    >
                      Anual (2 meses gratis)
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {plans.map((plan) => {
                    const price =
                      billingCycle === 'YEARLY' ? plan.priceYearly : plan.priceMonthly;
                    const isSelected = selectedPlanCode === plan.code;
                    return (
                      <button
                        key={plan.id}
                        type="button"
                        onClick={() => setSelectedPlanCode(plan.code)}
                        className={`text-left rounded-xl border p-4 transition-all ${
                          isSelected
                            ? 'border-indigo-600 bg-indigo-50/40 ring-2 ring-indigo-600/20'
                            : 'border-slate-200 hover:border-slate-300 bg-white'
                        }`}
                      >
                        <p className="font-semibold text-sm text-slate-900">{plan.name}</p>
                        <p className="text-lg font-bold text-slate-900 mt-1">
                          {formatMoney(price, plan.currency)}
                          <span className="text-xs font-normal text-slate-500">
                            /{billingCycle === 'YEARLY' ? 'año' : 'mes'}
                          </span>
                        </p>
                        <ul className="mt-2 space-y-1 text-xs text-slate-600">
                          <li>• Hasta {plan.maxProducts.toLocaleString()} productos</li>
                          <li>• {plan.maxStaff} usuarios de equipo</li>
                          <li>• {plan.allowCustomDomain ? 'Dominio propio SSL' : 'Subdominio incluido'}</li>
                        </ul>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex justify-between pt-2">
                <Button type="button" variant="outline" onClick={() => setStep(2)}>
                  <ArrowLeft className="size-4" /> Atrás
                </Button>
                <Button type="button" disabled={submitting} onClick={handleSubmit}>
                  {submitting ? 'Creando tienda...' : 'Publicar mi tienda ahora'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
