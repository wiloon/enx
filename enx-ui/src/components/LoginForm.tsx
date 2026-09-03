'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuth } from '@/hooks/useAuth'

export default function LoginForm() {
  const { signIn, isLoading } = useAuth()

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle className="text-center">Sign in to Catseye</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-gray-600 text-center">
          Use your email or Google account via AWS Cognito.
        </p>
        <Button
          type="button"
          className="w-full"
          disabled={isLoading}
          onClick={() => signIn()}
        >
          {isLoading ? 'Redirecting…' : 'Sign in'}
        </Button>
      </CardContent>
    </Card>
  )
}
