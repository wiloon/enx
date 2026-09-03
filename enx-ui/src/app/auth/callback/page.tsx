'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { exchangeCodeForTokens } from '@/lib/cognito'
import { useAuth } from '@/hooks/useAuth'

function CallbackHandler() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const { completeCognitoLogin } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const exchangeStarted = useRef(false)

  useEffect(() => {
    const code = searchParams.get('code')
    const err =
      searchParams.get('error_description') || searchParams.get('error')
    if (err) {
      setError(err)
      return
    }
    if (!code) {
      setError('Missing authorization code')
      return
    }
    if (exchangeStarted.current) {
      return
    }
    exchangeStarted.current = true

    exchangeCodeForTokens(code)
      .then((tokens) => completeCognitoLogin(tokens))
      .then(() => router.replace('/app'))
      .catch((e) =>
        setError(e instanceof Error ? e.message : 'Sign-in failed')
      )
  }, [searchParams, router, completeCognitoLogin])

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <div className="text-center text-red-600">
          <p className="font-medium">Sign-in failed</p>
          <p className="text-sm mt-2">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <p>Signing you in…</p>
    </div>
  )
}

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <p>Loading…</p>
        </div>
      }
    >
      <CallbackHandler />
    </Suspense>
  )
}
