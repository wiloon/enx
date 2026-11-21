'use client'

import { useAuthContext } from './context'

// Sends a signed-out visitor to the dedicated sign-in route, using the
// selected provider's own redirect.
export default function RedirectToSignIn() {
  const { RedirectToSignIn: Redirect } = useAuthContext()
  return <Redirect />
}
