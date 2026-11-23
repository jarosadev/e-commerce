'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import apiClient from '@/lib/api-client';

export default function VerifyOTPPage() {
  const [otp, setOtp] = useState('');

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiClient.post('/auth/platform/verify-otp', { otp });
      window.location.href = '/dashboard';
    } catch (error) {
      console.error('Verification failed', error);
    }
  };

  return (
    <div className="flex justify-center items-center min-h-screen">
      <form onSubmit={handleVerify} className="space-y-4 p-8 border rounded-lg shadow-sm">
        <h1 className="text-2xl font-bold">Verify OTP</h1>
        <Input type="text" placeholder="Enter OTP" value={otp} onChange={(e) => setOtp(e.target.value)} />
        <Button type="submit">Verify</Button>
      </form>
    </div>
  );
}
