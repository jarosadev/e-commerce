'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import apiClient from '@/lib/api-client';

export default function RegisterPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiClient.post('/auth/platform/register', { email, password });
      window.location.href = '/verify-otp';
    } catch (error) {
      console.error('Registration failed', error);
    }
  };

  return (
    <div className="flex justify-center items-center min-h-screen">
      <form onSubmit={handleRegister} className="space-y-4 p-8 border rounded-lg shadow-sm">
        <h1 className="text-2xl font-bold">Register</h1>
        <Input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <Button type="submit">Register</Button>
      </form>
    </div>
  );
}
