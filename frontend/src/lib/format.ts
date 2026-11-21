export function formatMoney(amount: number | string, currency = 'USD'): string {
  const num = typeof amount === 'string' ? Number(amount) : amount;
  if (Number.isNaN(num)) return `0.00 ${currency}`;
  try {
    return new Intl.NumberFormat('es-ES', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(num);
  } catch {
    return `${num.toFixed(2)} ${currency}`;
  }
}

export function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-ES', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  });
}

export function statusBadgeClass(status: string): string {
  switch (status) {
    case 'ACTIVE':
    case 'APPROVED':
      return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    case 'TRIAL':
    case 'TRIALING':
      return 'bg-blue-100 text-blue-800 border-blue-200';
    case 'PAST_DUE':
    case 'PENDING':
      return 'bg-amber-100 text-amber-800 border-amber-200';
    case 'SUSPENDED':
    case 'REJECTED':
    case 'CANCELED':
      return 'bg-rose-100 text-rose-800 border-rose-200';
    default:
      return 'bg-slate-100 text-slate-700 border-slate-200';
  }
}

export function extractErrorMessage(err: unknown, fallback = 'Ocurrió un error inesperado.'): string {
  if (typeof err === 'object' && err !== null && 'response' in err) {
    const resp = (err as { response?: { data?: { message?: string | string[]; detail?: string } } })
      .response;
    const msg = resp?.data?.message ?? resp?.data?.detail;
    if (Array.isArray(msg)) return msg.join(', ');
    if (typeof msg === 'string' && msg.trim()) return msg;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
