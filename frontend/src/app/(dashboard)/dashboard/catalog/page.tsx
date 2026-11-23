'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FolderTree,
  Grid2x2Plus,
  Layers,
  Minus,
  Package,
  Plus,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import { DashboardNav, type DashboardStoreOption } from '@/components/dashboard/DashboardNav';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import apiClient from '@/lib/api-client';
import { extractErrorMessage, formatMoney } from '@/lib/format';
import { uploadFileViaPresignedUrl } from '@/lib/storage-upload';

interface CategoryItem {
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  parent: { id: string; name: string } | null;
  _count: { products: number; children: number };
}

interface VariantItem {
  id: string;
  sku: string;
  title: string;
  retailPrice: number;
  stockOnHand: number;
  stockReserved: number;
  availableStock: number;
  lowStockThreshold: number;
  isLowStock: boolean;
}

interface WholesaleTierItem {
  id?: string;
  minQuantity: number;
  maxQuantity: number | null;
  unitPrice: number;
  label: string | null;
}

interface ProductItem {
  id: string;
  name: string;
  slug: string;
  brand: string | null;
  minOrderQty: number;
  isWholesaleOnly: boolean;
  isActive: boolean;
  category: { id: string; name: string } | null;
  images: Array<{ id: string; url: string; altText: string | null; sortOrder: number }>;
  variants: VariantItem[];
  wholesaleTiers: WholesaleTierItem[];
}

interface LowStockAlertItem {
  variantId: string;
  productId: string;
  productName: string;
  sku: string;
  title: string;
  stockOnHand: number;
  stockReserved: number;
  availableStock: number;
  lowStockThreshold: number;
  isOutOfStock: boolean;
}

export default function DashboardCatalogPage() {
  const [stores, setStores] = useState<DashboardStoreOption[]>([]);
  const [selectedSlug, setSelectedSlug] = useState('');
  const [activeTab, setActiveTab] = useState<'products' | 'categories' | 'low-stock'>('products');

  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [lowStockAlerts, setLowStockAlerts] = useState<LowStockAlertItem[]>([]);
  const [search, setSearch] = useState('');
  const [expandedProductId, setExpandedProductId] = useState<string | null>(null);

  // Create Category form
  const [catName, setCatName] = useState('');
  const [catParentId, setCatParentId] = useState('');
  const [catSortOrder, setCatSortOrder] = useState('0');

  // Create Product form
  const [prodName, setProdName] = useState('');
  const [prodBrand, setProdBrand] = useState('');
  const [prodCategoryId, setProdCategoryId] = useState('');
  const [prodMinQty, setProdMinQty] = useState('1');
  const [prodWholesaleOnly, setProdWholesaleOnly] = useState(false);
  const [prodImageUrl, setProdImageUrl] = useState('');
  const [uploadingImg, setUploadingImg] = useState(false);

  // Matrix Variant Generator form (per expanded product)
  const [matrixSkuPrefix, setMatrixSkuPrefix] = useState('SKU');
  const [matrixAxis1Name, setMatrixAxis1Name] = useState('talla');
  const [matrixAxis1Values, setMatrixAxis1Values] = useState('S, M, L');
  const [matrixAxis2Name, setMatrixAxis2Name] = useState('color');
  const [matrixAxis2Values, setMatrixAxis2Values] = useState('Negro, Blanco');
  const [matrixPrice, setMatrixPrice] = useState('35');
  const [matrixStock, setMatrixStock] = useState('20');

  // Wholesale Tier editor form (per expanded product)
  const [tierMinQty, setTierMinQty] = useState('6');
  const [tierMaxQty, setTierMaxQty] = useState('11');
  const [tierUnitPrice, setTierUnitPrice] = useState('28');
  const [tierLabel, setTierLabel] = useState('Media Docena B2B');

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const loadCatalog = useCallback(
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
        const [catsRes, prodsRes, alertsRes] = await Promise.all([
          apiClient.get<CategoryItem[]>('/catalog/categories', { headers }),
          apiClient.get<{ items: ProductItem[] }>('/catalog/products', {
            headers,
            params: { search: search.trim() || undefined, limit: 50 },
          }),
          apiClient.get<{ items: LowStockAlertItem[] }>('/catalog/inventory/low-stock', {
            headers,
          }),
        ]);

        setCategories(catsRes.data);
        setProducts(prodsRes.data.items ?? []);
        setLowStockAlerts(alertsRes.data.items ?? []);
        setError(null);
      } catch (err) {
        setError(extractErrorMessage(err, 'No se pudo cargar el catálogo de tu tienda.'));
      } finally {
        setLoading(false);
      }
    },
    [search],
  );

  useEffect(() => {
    let active = true;
    const run = async () => {
      if (active) await loadCatalog();
    };
    void run();
    return () => {
      active = false;
    };
  }, [loadCatalog]);

  const handleSelectStore = (slug: string) => {
    setSelectedSlug(slug);
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('x-tenant-host', `${slug}.localhost:3000`);
    }
    void loadCatalog(slug);
  };

  const handleUploadProductImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedSlug) return;
    setUploadingImg(true);
    setError(null);
    try {
      const uploaded = await uploadFileViaPresignedUrl(selectedSlug, 'catalog', file);
      if (uploaded.publicUrl) {
        setProdImageUrl(uploaded.publicUrl);
        setFeedback('Imagen de producto subida a S3 correctamente.');
      }
    } catch (err) {
      setError(extractErrorMessage(err, 'Error al subir la imagen del producto.'));
    } finally {
      setUploadingImg(false);
    }
  };

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSlug || !catName.trim()) return;
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      await apiClient.post(
        '/catalog/categories',
        {
          name: catName.trim(),
          parentId: catParentId || null,
          sortOrder: Number(catSortOrder) || 0,
        },
        { headers: { 'x-tenant-slug': selectedSlug } },
      );
      setCatName('');
      setCatParentId('');
      setFeedback('Categoría creada correctamente.');
      await loadCatalog(selectedSlug);
    } catch (err) {
      setError(extractErrorMessage(err, 'No se pudo crear la categoría.'));
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteCategory = async (categoryId: string) => {
    if (!selectedSlug) return;
    setBusy(true);
    try {
      await apiClient.delete(`/catalog/categories/${categoryId}`, {
        headers: { 'x-tenant-slug': selectedSlug },
      });
      setFeedback('Categoría eliminada.');
      await loadCatalog(selectedSlug);
    } catch (err) {
      setError(extractErrorMessage(err, 'No se pudo eliminar la categoría.'));
    } finally {
      setBusy(false);
    }
  };

  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSlug || !prodName.trim()) return;
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await apiClient.post<ProductItem>(
        '/catalog/products',
        {
          name: prodName.trim(),
          brand: prodBrand.trim() || null,
          categoryId: prodCategoryId || null,
          minOrderQty: Number(prodMinQty) || 1,
          isWholesaleOnly: prodWholesaleOnly,
          images: prodImageUrl.trim()
            ? [{ url: prodImageUrl.trim(), altText: prodName.trim(), sortOrder: 0 }]
            : undefined,
        },
        { headers: { 'x-tenant-slug': selectedSlug } },
      );
      setProdName('');
      setProdBrand('');
      setProdImageUrl('');
      setExpandedProductId(res.data.id);
      setFeedback('Producto creado. Ahora puedes generar su matriz de variantes y precios B2B.');
      await loadCatalog(selectedSlug);
    } catch (err) {
      setError(extractErrorMessage(err, 'No se pudo crear el producto (verifica cuota del plan).'));
    } finally {
      setBusy(false);
    }
  };

  const handleGenerateMatrix = async (productId: string) => {
    if (!selectedSlug) return;
    setBusy(true);
    setError(null);
    setFeedback(null);
    const axes = [];
    const vals1 = matrixAxis1Values
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const vals2 = matrixAxis2Values
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (matrixAxis1Name.trim() && vals1.length > 0) {
      axes.push({ name: matrixAxis1Name.trim(), values: vals1 });
    }
    if (matrixAxis2Name.trim() && vals2.length > 0) {
      axes.push({ name: matrixAxis2Name.trim(), values: vals2 });
    }
    try {
      const res = await apiClient.post<{ createdCount: number; skippedCount: number }>(
        `/catalog/products/${productId}/variants/matrix`,
        {
          skuPrefix: matrixSkuPrefix.trim() || 'SKU',
          axes,
          retailPrice: Number(matrixPrice) || 10,
          stockOnHand: Number(matrixStock) || 0,
        },
        { headers: { 'x-tenant-slug': selectedSlug } },
      );
      setFeedback(
        `Matriz generada: ${res.data.createdCount} variantes creadas (${res.data.skippedCount} SKUs existentes omitidos).`,
      );
      await loadCatalog(selectedSlug);
    } catch (err) {
      setError(extractErrorMessage(err, 'No se pudo generar la matriz de variantes.'));
    } finally {
      setBusy(false);
    }
  };

  const handleAdjustStock = async (variantId: string, delta: number) => {
    if (!selectedSlug) return;
    setBusy(true);
    setError(null);
    try {
      await apiClient.patch(
        `/catalog/variants/${variantId}/stock`,
        { mode: 'DELTA', quantity: delta },
        { headers: { 'x-tenant-slug': selectedSlug } },
      );
      await loadCatalog(selectedSlug);
    } catch (err) {
      setError(extractErrorMessage(err, 'No se pudo ajustar el stock.'));
    } finally {
      setBusy(false);
    }
  };

  const handleAddWholesaleTier = async (product: ProductItem) => {
    if (!selectedSlug) return;
    setBusy(true);
    setError(null);
    setFeedback(null);
    const nextTiers = [
      ...product.wholesaleTiers.map((t) => ({
        minQuantity: t.minQuantity,
        maxQuantity: t.maxQuantity,
        unitPrice: t.unitPrice,
        label: t.label,
      })),
      {
        minQuantity: Number(tierMinQty),
        maxQuantity: tierMaxQty.trim() ? Number(tierMaxQty) : null,
        unitPrice: Number(tierUnitPrice),
        label: tierLabel.trim() || null,
      },
    ];
    try {
      await apiClient.put(
        `/catalog/products/${product.id}/wholesale-tiers`,
        { tiers: nextTiers },
        { headers: { 'x-tenant-slug': selectedSlug } },
      );
      setFeedback('Tabla de precios mayoristas B2B actualizada correctamente.');
      await loadCatalog(selectedSlug);
    } catch (err) {
      setError(extractErrorMessage(err, 'Error al guardar tramos mayoristas (revisa solapamientos).'));
    } finally {
      setBusy(false);
    }
  };

  const handleClearWholesaleTiers = async (productId: string) => {
    if (!selectedSlug) return;
    setBusy(true);
    try {
      await apiClient.put(
        `/catalog/products/${productId}/wholesale-tiers`,
        { tiers: [] },
        { headers: { 'x-tenant-slug': selectedSlug } },
      );
      setFeedback('Tramos mayoristas limpiados.');
      await loadCatalog(selectedSlug);
    } catch (err) {
      setError(extractErrorMessage(err, 'No se pudieron limpiar los tramos.'));
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
        onRefresh={() => void loadCatalog(selectedSlug)}
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
          <Button
            size="sm"
            variant={activeTab === 'products' ? 'default' : 'outline'}
            onClick={() => setActiveTab('products')}
          >
            <Package className="size-4" /> Productos & Variantes ({products.length})
          </Button>
          <Button
            size="sm"
            variant={activeTab === 'categories' ? 'default' : 'outline'}
            onClick={() => setActiveTab('categories')}
          >
            <FolderTree className="size-4" /> Categorías ({categories.length})
          </Button>
          <Button
            size="sm"
            variant={activeTab === 'low-stock' ? 'default' : 'outline'}
            onClick={() => setActiveTab('low-stock')}
          >
            <AlertTriangle className="size-4 text-amber-500" /> Alertas Stock Bajo (
            {lowStockAlerts.length})
          </Button>
        </div>

        {loading ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center text-sm text-slate-500">
            Cargando catálogo de tu tienda...
          </div>
        ) : (
          <>
            {/* TAB 1: PRODUCTS + MATRIX VARIANTS + WHOLESALE B2B */}
            {activeTab === 'products' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <form
                  onSubmit={handleCreateProduct}
                  className="lg:col-span-4 bg-white border border-slate-200 rounded-2xl p-5 space-y-3.5 h-fit"
                >
                  <h2 className="font-bold text-slate-900 text-sm">Nuevo Producto B2C / B2B</h2>
                  <Input
                    required
                    placeholder="Nombre del producto *"
                    value={prodName}
                    onChange={(e) => setProdName(e.target.value)}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      placeholder="Marca"
                      value={prodBrand}
                      onChange={(e) => setProdBrand(e.target.value)}
                    />
                    <Input
                      type="number"
                      min={1}
                      placeholder="Mínimo uds."
                      value={prodMinQty}
                      onChange={(e) => setProdMinQty(e.target.value)}
                    />
                  </div>
                  <select
                    value={prodCategoryId}
                    onChange={(e) => setProdCategoryId(e.target.value)}
                    className="w-full h-9 rounded-lg border border-slate-200 px-3 text-xs bg-white"
                  >
                    <option value="">Sin categoría</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <div className="flex gap-2">
                    <Input
                      placeholder="URL imagen o sube a S3"
                      value={prodImageUrl}
                      onChange={(e) => setProdImageUrl(e.target.value)}
                    />
                    <label className="inline-flex items-center gap-1 px-2.5 h-9 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-semibold cursor-pointer shrink-0">
                      <Upload className="size-3.5" />
                      {uploadingImg ? '...' : 'S3'}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        disabled={uploadingImg}
                        onChange={(e) => void handleUploadProductImage(e)}
                      />
                    </label>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={prodWholesaleOnly}
                      onChange={(e) => setProdWholesaleOnly(e.target.checked)}
                    />
                    Solo venta mayorista B2B
                  </label>
                  <Button type="submit" disabled={busy} className="w-full">
                    <Plus className="size-4" /> Crear Producto
                  </Button>
                </form>

                <div className="lg:col-span-8 space-y-4">
                  <div className="relative">
                    <Search className="size-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <Input
                      className="pl-9 bg-white"
                      placeholder="Buscar por nombre, marca o SKU..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>

                  <div className="space-y-3">
                    {products.map((product) => {
                      const isOpen = expandedProductId === product.id;
                      return (
                        <div
                          key={product.id}
                          className="bg-white border border-slate-200 rounded-2xl overflow-hidden"
                        >
                          <div className="p-4 flex flex-wrap items-center justify-between gap-3">
                            <div className="flex items-center gap-3">
                              {product.images[0] ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={product.images[0].url}
                                  alt={product.name}
                                  className="size-12 rounded-lg object-cover border border-slate-200"
                                />
                              ) : (
                                <div className="size-12 rounded-lg bg-slate-100 flex items-center justify-center text-slate-400">
                                  <Package className="size-5" />
                                </div>
                              )}
                              <div>
                                <p className="font-bold text-sm text-slate-900">{product.name}</p>
                                <p className="text-xs text-slate-500">
                                  {product.category?.name ?? 'General'} · {product.variants.length}{' '}
                                  variantes · {product.wholesaleTiers.length} tramos B2B
                                </p>
                              </div>
                            </div>
                            <Button
                              size="sm"
                              variant={isOpen ? 'secondary' : 'outline'}
                              onClick={() => setExpandedProductId(isOpen ? null : product.id)}
                            >
                              {isOpen ? 'Ocultar gestión' : 'Variantes, Stock & B2B'}
                            </Button>
                          </div>

                          {isOpen && (
                            <div className="border-t border-slate-100 bg-slate-50/70 p-4 space-y-5">
                              {/* Variantes actuales y stock atómico */}
                              <div className="space-y-2">
                                <p className="text-xs font-bold uppercase text-slate-500">
                                  Variantes & Control Atómico de Stock
                                </p>
                                {product.variants.length === 0 ? (
                                  <p className="text-xs text-slate-500">
                                    Sin variantes aún. Usa el generador matricial debajo.
                                  </p>
                                ) : (
                                  <div className="space-y-1.5">
                                    {product.variants.map((v) => (
                                      <div
                                        key={v.id}
                                        className="bg-white border border-slate-200 rounded-xl px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs"
                                      >
                                        <div>
                                          <span className="font-semibold text-slate-900">
                                            {v.title}
                                          </span>{' '}
                                          <span className="font-mono text-slate-500">({v.sku})</span>{' '}
                                          · <strong>{formatMoney(v.retailPrice)}</strong>
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <span
                                            className={`px-2 py-0.5 rounded-full font-semibold ${
                                              v.isLowStock
                                                ? 'bg-amber-100 text-amber-800'
                                                : 'bg-emerald-100 text-emerald-800'
                                            }`}
                                          >
                                            Disp: {v.availableStock} (Fís: {v.stockOnHand} / Res:{' '}
                                            {v.stockReserved})
                                          </span>
                                          <Button
                                            size="icon-xs"
                                            variant="outline"
                                            disabled={busy}
                                            onClick={() => void handleAdjustStock(v.id, -1)}
                                          >
                                            <Minus className="size-3" />
                                          </Button>
                                          <Button
                                            size="icon-xs"
                                            variant="outline"
                                            disabled={busy}
                                            onClick={() => void handleAdjustStock(v.id, 1)}
                                          >
                                            <Plus className="size-3" />
                                          </Button>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>

                              {/* Generador Matricial de Variantes */}
                              <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-3">
                                <p className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                                  <Grid2x2Plus className="size-4 text-indigo-600" />
                                  Generador Matricial de Variantes (Eje 1 × Eje 2)
                                </p>
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                  <Input
                                    placeholder="Prefijo SKU"
                                    value={matrixSkuPrefix}
                                    onChange={(e) => setMatrixSkuPrefix(e.target.value)}
                                  />
                                  <Input
                                    type="number"
                                    step="0.01"
                                    placeholder="Precio minorista"
                                    value={matrixPrice}
                                    onChange={(e) => setMatrixPrice(e.target.value)}
                                  />
                                  <Input
                                    type="number"
                                    placeholder="Stock inicial"
                                    value={matrixStock}
                                    onChange={(e) => setMatrixStock(e.target.value)}
                                  />
                                  <Input
                                    placeholder="Eje 1 (ej. talla)"
                                    value={matrixAxis1Name}
                                    onChange={(e) => setMatrixAxis1Name(e.target.value)}
                                  />
                                  <Input
                                    className="col-span-1 sm:col-span-2"
                                    placeholder="Valores (S, M, L)"
                                    value={matrixAxis1Values}
                                    onChange={(e) => setMatrixAxis1Values(e.target.value)}
                                  />
                                  <Input
                                    placeholder="Eje 2 (ej. color)"
                                    value={matrixAxis2Name}
                                    onChange={(e) => setMatrixAxis2Name(e.target.value)}
                                  />
                                  <Input
                                    className="col-span-1 sm:col-span-2"
                                    placeholder="Valores (Negro, Blanco)"
                                    value={matrixAxis2Values}
                                    onChange={(e) => setMatrixAxis2Values(e.target.value)}
                                  />
                                </div>
                                <Button
                                  size="sm"
                                  disabled={busy}
                                  onClick={() => void handleGenerateMatrix(product.id)}
                                >
                                  Generar Matriz de Variantes
                                </Button>
                              </div>

                              {/* Tramos Mayoristas B2B */}
                              <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-3">
                                <div className="flex items-center justify-between">
                                  <p className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                                    <Layers className="size-4 text-emerald-600" />
                                    Escala de Precios Mayoristas B2B
                                  </p>
                                  {product.wholesaleTiers.length > 0 && (
                                    <Button
                                      size="xs"
                                      variant="ghost"
                                      disabled={busy}
                                      onClick={() => void handleClearWholesaleTiers(product.id)}
                                    >
                                      Limpiar tramos
                                    </Button>
                                  )}
                                </div>
                                {product.wholesaleTiers.length > 0 && (
                                  <div className="flex flex-wrap gap-2">
                                    {product.wholesaleTiers.map((t, i) => (
                                      <span
                                        key={t.id ?? i}
                                        className="text-xs px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 font-medium"
                                      >
                                        {t.minQuantity}–{t.maxQuantity ?? '∞'} uds →{' '}
                                        <strong>{formatMoney(t.unitPrice)}</strong> c/u
                                        {t.label ? ` (${t.label})` : ''}
                                      </span>
                                    ))}
                                  </div>
                                )}
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                  <Input
                                    type="number"
                                    min={2}
                                    placeholder="Mín. uds"
                                    value={tierMinQty}
                                    onChange={(e) => setTierMinQty(e.target.value)}
                                  />
                                  <Input
                                    type="number"
                                    placeholder="Máx. (vacío = ∞)"
                                    value={tierMaxQty}
                                    onChange={(e) => setTierMaxQty(e.target.value)}
                                  />
                                  <Input
                                    type="number"
                                    step="0.01"
                                    placeholder="Precio unit."
                                    value={tierUnitPrice}
                                    onChange={(e) => setTierUnitPrice(e.target.value)}
                                  />
                                  <Input
                                    placeholder="Etiqueta B2B"
                                    value={tierLabel}
                                    onChange={(e) => setTierLabel(e.target.value)}
                                  />
                                </div>
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  disabled={busy}
                                  onClick={() => void handleAddWholesaleTier(product)}
                                >
                                  Agregar Tramo Mayorista
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: CATEGORIES */}
            {activeTab === 'categories' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <form
                  onSubmit={handleCreateCategory}
                  className="lg:col-span-4 bg-white border border-slate-200 rounded-2xl p-5 space-y-3.5 h-fit"
                >
                  <h2 className="font-bold text-slate-900 text-sm">Nueva Categoría</h2>
                  <Input
                    required
                    placeholder="Nombre de categoría *"
                    value={catName}
                    onChange={(e) => setCatName(e.target.value)}
                  />
                  <select
                    value={catParentId}
                    onChange={(e) => setCatParentId(e.target.value)}
                    className="w-full h-9 rounded-lg border border-slate-200 px-3 text-xs bg-white"
                  >
                    <option value="">Categoría raíz (sin padre)</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        Subcategoría de: {c.name}
                      </option>
                    ))}
                  </select>
                  <Input
                    type="number"
                    min={0}
                    placeholder="Orden visual (0, 1, 2...)"
                    value={catSortOrder}
                    onChange={(e) => setCatSortOrder(e.target.value)}
                  />
                  <Button type="submit" disabled={busy} className="w-full">
                    <Plus className="size-4" /> Guardar Categoría
                  </Button>
                </form>

                <div className="lg:col-span-8 bg-white border border-slate-200 rounded-2xl divide-y divide-slate-100">
                  {categories.map((c) => (
                    <div key={c.id} className="p-4 flex items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold text-sm text-slate-900">{c.name}</p>
                        <p className="text-xs text-slate-500">
                          /{c.slug} · Orden: {c.sortOrder} · {c._count.products} productos
                          {c.parent ? ` · Padre: ${c.parent.name}` : ''}
                        </p>
                      </div>
                      <Button
                        size="xs"
                        variant="destructive"
                        disabled={busy}
                        onClick={() => void handleDeleteCategory(c.id)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* TAB 3: LOW STOCK ALERTS */}
            {activeTab === 'low-stock' && (
              <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
                <h2 className="font-bold text-slate-900 flex items-center gap-2">
                  <AlertTriangle className="size-5 text-amber-500" />
                  Alertas de Inventario Bajo
                </h2>
                {lowStockAlerts.length === 0 ? (
                  <p className="py-8 text-center text-sm text-emerald-700">
                    ¡Excelente! Todas tus variantes tienen stock disponible por encima de su umbral.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                      <thead className="text-xs uppercase text-slate-400 border-b border-slate-100">
                        <tr>
                          <th className="py-2 pr-4">Producto / Variante</th>
                          <th className="py-2 pr-4">SKU</th>
                          <th className="py-2 pr-4">Disponible / Umbral</th>
                          <th className="py-2 text-right">Reposición rápida</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {lowStockAlerts.map((a) => (
                          <tr key={a.variantId}>
                            <td className="py-3 pr-4">
                              <p className="font-semibold text-slate-900">{a.productName}</p>
                              <p className="text-xs text-slate-500">{a.title}</p>
                            </td>
                            <td className="py-3 pr-4 font-mono text-xs text-slate-600">{a.sku}</td>
                            <td className="py-3 pr-4">
                              <span
                                className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${
                                  a.isOutOfStock
                                    ? 'bg-rose-100 text-rose-800'
                                    : 'bg-amber-100 text-amber-800'
                                }`}
                              >
                                {a.availableStock} uds (mín: {a.lowStockThreshold})
                              </span>
                            </td>
                            <td className="py-3 text-right">
                              <Button
                                size="xs"
                                disabled={busy}
                                onClick={() => void handleAdjustStock(a.variantId, 10)}
                              >
                                +10 uds al stock
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
