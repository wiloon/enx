'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import LoginForm from './LoginForm';
import HelloWorld from './HelloWorld';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { apiService } from '@/services/api';

export default function AuthWrapper() {
  const { isAuthenticated, user, logout, initializeSession, isLoading } = useAuth();
  const [resendStatus, setResendStatus] = useState<'idle' | 'sending' | 'sent'>('idle');

  useEffect(() => {
    initializeSession();
  }, []);

  const handleResendVerification = async () => {
    if (!user?.email || resendStatus !== 'idle') return;
    setResendStatus('sending');
    try {
      await apiService.resendVerification(user.email);
    } catch {
      // Non-fatal
    } finally {
      setResendStatus('sent');
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto mb-4"></div>
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen p-8 flex items-center justify-center">
        <LoginForm />
      </div>
    );
  }

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-4xl mx-auto">
        {user?.status === 'pending' && (
          <div className="mb-6 flex items-center justify-between rounded-md border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
            <span>
              Your email is not verified. Verify now to enable password reset.
            </span>
            <button
              onClick={handleResendVerification}
              disabled={resendStatus !== 'idle'}
              className="ml-4 rounded bg-yellow-600 px-3 py-1 text-xs font-medium text-white hover:bg-yellow-700 disabled:opacity-50"
            >
              {resendStatus === 'sending' ? 'Sending…' : resendStatus === 'sent' ? 'Sent!' : 'Resend email'}
            </button>
          </div>
        )}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-2xl font-bold">Welcome, {user?.username}!</h1>
            <p className="text-gray-600">ENX Learning Platform</p>
          </div>
          <Button variant="outline" onClick={() => logout()}>
            Logout
          </Button>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Word Lookup</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600 mb-4">
                Look up English words to see their Chinese translation, IPA pronunciation, 
                lookup count, and mastery status.
              </p>
              <Link href="/lookup">
                <Button className="w-full">
                  Go to Word Lookup
                </Button>
              </Link>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader>
              <CardTitle>Hello World</CardTitle>
            </CardHeader>
            <CardContent>
              <HelloWorld />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}