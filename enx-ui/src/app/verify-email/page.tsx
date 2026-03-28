'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiService } from '@/services/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

type VerifyState = 'loading' | 'success' | 'error';

export default function VerifyEmailPage() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [state, setState] = useState<VerifyState>('loading');
  const [message, setMessage] = useState('');
  const [resendEmail, setResendEmail] = useState('');
  const [resendStatus, setResendStatus] = useState<'idle' | 'sending' | 'sent'>('idle');

  useEffect(() => {
    if (!token) {
      setState('error');
      setMessage('Invalid activation link.');
      return;
    }

    apiService.verifyEmail(token).then((resp) => {
      if (resp.success && resp.data?.success) {
        setState('success');
      } else {
        setState('error');
        setMessage(resp.data?.message ?? resp.error ?? 'Verification failed.');
      }
    });
  }, [token]);

  const handleResend = async () => {
    if (!resendEmail || resendStatus !== 'idle') return;
    setResendStatus('sending');
    await apiService.resendVerification(resendEmail);
    setResendStatus('sent');
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <Card className="w-full max-w-md mx-auto">
        <CardHeader>
          <CardTitle className="text-center">Email Verification</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-center">
          {state === 'loading' && (
            <div>
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto mb-4" />
              <p>Verifying your account…</p>
            </div>
          )}

          {state === 'success' && (
            <div className="space-y-2">
              <div className="text-4xl">✅</div>
              <p className="font-semibold">Account activated!</p>
              <p className="text-gray-600">Open the ENX extension and log in.</p>
            </div>
          )}

          {state === 'error' && (
            <div className="space-y-4">
              <div className="text-4xl">❌</div>
              <p className="text-red-600">{message}</p>
              <div className="space-y-2">
                <p className="text-sm text-gray-600">Enter your email to receive a new activation link:</p>
                <input
                  type="email"
                  placeholder="your@email.com"
                  value={resendEmail}
                  onChange={(e) => setResendEmail(e.target.value)}
                  className="w-full rounded-md border px-3 py-2 text-sm"
                />
                <Button
                  onClick={handleResend}
                  disabled={!resendEmail || resendStatus !== 'idle'}
                  className="w-full"
                >
                  {resendStatus === 'sending' ? 'Sending…' : resendStatus === 'sent' ? 'Sent! Check your inbox.' : 'Resend activation email'}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
