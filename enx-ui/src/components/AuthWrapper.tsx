'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/hooks/useAuth'
import LoginForm from './LoginForm'
import HelloWorld from './HelloWorld'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function AuthWrapper() {
  const { isAuthenticated, user, logout, initializeSession } = useAuth()
  const [initializing, setInitializing] = useState(true)

  useEffect(() => {
    initializeSession().finally(() => setInitializing(false))
  }, [initializeSession])

  if (initializing) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto mb-4" />
          <p>Loading...</p>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen p-8 flex items-center justify-center">
        <LoginForm />
      </div>
    )
  }

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-2xl font-bold">Welcome, {user?.username}!</h1>
            <p className="text-gray-600">Catseye</p>
          </div>
          <Button variant="outline" onClick={() => logout()}>
            Sign out
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Word Lookup</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600 mb-4">
                Look up English words to see their Chinese translation, IPA
                pronunciation, lookup count, and mastery status.
              </p>
              <Link href="/lookup">
                <Button className="w-full">Go to Word Lookup</Button>
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Idiomatic Phrasing</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600 mb-4">
                Turn Chinese or rough English into the way an American teammate
                would phrase it, with alternatives and notes.
              </p>
              <Link href="/rephrase">
                <Button className="w-full">Go to Idiomatic Phrasing</Button>
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Subscription &amp; Credits</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600 mb-4">
                Upgrade to Catseye Pro or buy AI translation credits, and check
                your current balance.
              </p>
              <Link href="/billing">
                <Button className="w-full">Go to Subscription &amp; Credits</Button>
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
  )
}
