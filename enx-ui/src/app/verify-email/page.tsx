'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default function VerifyEmailPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <div className="text-center max-w-md">
        <p className="mb-4 text-gray-600">
          Email verification is handled by AWS Cognito during sign-in.
        </p>
        <Link href="/">
          <Button>Back to home</Button>
        </Link>
      </div>
    </div>
  )
}
