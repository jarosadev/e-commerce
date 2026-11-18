'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import apiClient from '@/lib/api-client';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiClient.post('/auth/platform/forgot-password', { email });
      alert('Check your email');
    } catch (error) {
      console.error('Request failed', error);
    }
  };

  return (
    <div className="flex justify-center items-center min-h-screen">
      <form onSubmit={handleForgot} className="space-y-4 p-8 border rounded-lg shadow-sm">
        <h1 className="text-2xl font-bold">Forgot Password</h1>
        <Input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Button type="submit">Reset Password</Button>
      </form>
    </div>
  );
}
