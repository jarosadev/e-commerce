'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Lock, Mail, Store } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import apiClient from '@/lib/api-client';
import { extractErrorMessage } from '@/lib/format';

interface PlatformLoginResponse {
  user?: {
    id: string;
    email: string;
    fullName: string;
    role: 'SUPER_ADMIN' | 'STORE_OWNER' | 'STORE_STAFF';
  };
}

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiClient.post<PlatformLoginResponse>('/auth/platform/login', {
        email,
        password,
      });
      const role = res.data?.user?.role;
      window.location.href = role === 'SUPER_ADMIN' ? '/superadmin' : '/dashboard';
    } catch (err) {
      setError(extractErrorMessage(err, 'Credenciales inválidas. Verifica tu email y contraseña.'));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = () => {
    const returnUrl = encodeURIComponent(`${window.location.origin}/dashboard`);
    window.location.href = `http://localhost:4000/api/v1/auth/google/start?scope=platform&returnUrl=${returnUrl}`;
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-sm p-8 space-y-6">
        <div className="space-y-2 text-center">
          <div className="mx-auto size-11 rounded-xl bg-slate-900 text-white flex items-center justify-center">
            <Store className="size-5" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Inicia sesión en Vendexa
          </h1>
          <p className="text-sm text-slate-500">
            Accede a tu panel de tienda o a la consola SuperAdmin SaaS
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-700" htmlFor="email">
              Correo electrónico
            </label>
            <div className="relative">
              <Mail className="size-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <Input
                id="email"
                type="email"
                required
                className="pl-9"
                placeholder="carlos@urbanthreads.local"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-slate-700" htmlFor="password">
                Contraseña
              </label>
              <Link
                href="/forgot-password"
                className="text-xs text-indigo-600 hover:underline font-medium"
              >
                ¿Olvidaste tu clave?
              </Link>
            </div>
            <div className="relative">
              <Lock className="size-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <Input
                id="password"
                type="password"
                required
                className="pl-9"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          <Button type="submit" disabled={loading} className="w-full h-10">
            {loading ? 'Ingresando...' : 'Ingresar con Email'}
          </Button>
        </form>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-slate-200" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-white px-2 text-slate-400">o continúa con</span>
          </div>
        </div>

        <Button
          type="button"
          variant="outline"
          onClick={handleGoogleLogin}
          className="w-full h-10"
        >
          Continuar con Google
        </Button>

        <p className="text-center text-xs text-slate-500">
          ¿Aún no tienes tienda?{' '}
          <Link href="/register" className="text-indigo-600 font-semibold hover:underline">
            Crea tu cuenta gratis
          </Link>
        </p>
      </div>
    </div>
  );
}
