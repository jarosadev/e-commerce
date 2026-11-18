'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import apiClient from '@/lib/api-client';

export default function ResetPasswordPage() {
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiClient.post('/auth/platform/reset-password', { token, password });
      window.location.href = '/login';
    } catch (error) {
      console.error('Reset failed', error);
    }
  };

  return (
    <div className="flex justify-center items-center min-h-screen">
      <form onSubmit={handleReset} className="space-y-4 p-8 border rounded-lg shadow-sm">
        <h1 className="text-2xl font-bold">Reset Password</h1>
        <Input type="text" placeholder="Token" value={token} onChange={(e) => setToken(e.target.value)} />
        <Input type="password" placeholder="New Password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <Button type="submit">Reset</Button>
      </form>
    </div>
  );
}
