'use client'

import { SignIn } from '@clerk/nextjs'

// ADR-015: Clerk's prebuilt sign-in (Google + GitHub + email/password). Used by
// the /sign-in route and rendered by <AuthWrapper> when a viewer hits the app
// signed out.
export default function LoginForm() {
  return (
    <div className="flex justify-center">
      <SignIn />
    </div>
  )
}
