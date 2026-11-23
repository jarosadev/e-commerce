'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Building2,
  CreditCard,
  ExternalLink,
  Package,
  Palette,
  Plus,
  RefreshCw,
  Sliders,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface DashboardStoreOption {
  id: string;
  slug: string;
  name: string;
  status: string;
}

interface DashboardNavProps {
  stores: DashboardStoreOption[];
  selectedSlug: string;
  onSelectStore: (slug: string) => void;
  onRefresh?: () => void;
}

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Suscripción', icon: CreditCard },
  { href: '/dashboard/theme', label: 'Diseño & Marca', icon: Palette },
  { href: '/dashboard/catalog', label: 'Catálogo & B2B', icon: Package },
  { href: '/dashboard/settings', label: 'Pagos, Envíos & Clientes', icon: Sliders },
];

export function DashboardNav({
  stores,
  selectedSlug,
  onSelectStore,
  onRefresh,
}: DashboardNavProps) {
  const pathname = usePathname();

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-lg bg-slate-900 text-white flex items-center justify-center">
              <Building2 className="size-5" />
            </div>
            <div>
              <h1 className="text-base font-bold text-slate-900 leading-tight">
                Panel de Comercio
              </h1>
              <p className="text-xs text-slate-500">
                {selectedSlug ? `${selectedSlug}.vendexa.app` : 'Administración de tienda'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {stores.length > 0 && (
              <select
                aria-label="Seleccionar tienda"
                value={selectedSlug}
                onChange={(e) => onSelectStore(e.target.value)}
                className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700"
              >
                {stores.map((s) => (
                  <option key={s.id} value={s.slug}>
                    {s.name} ({s.slug})
                  </option>
                ))}
              </select>
            )}
            {selectedSlug && (
              <Link
                href={`/store/${selectedSlug}`}
                className="hidden sm:inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-700 px-2"
              >
                Ver Tienda <ExternalLink className="size-3.5" />
              </Link>
            )}
            <Link href="/dashboard/onboarding">
              <Button size="sm">
                <Plus className="size-4" /> Nueva tienda
              </Button>
            </Link>
            {onRefresh && (
              <Button size="sm" variant="outline" onClick={onRefresh}>
                <RefreshCw className="size-3.5" />
              </Button>
            )}
          </div>
        </div>

        <nav className="flex items-center gap-1 overflow-x-auto -mb-px">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`inline-flex items-center gap-2 px-3.5 py-2.5 text-xs sm:text-sm font-semibold border-b-2 whitespace-nowrap transition-colors ${
                  active
                    ? 'border-indigo-600 text-indigo-700'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <Icon className="size-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
