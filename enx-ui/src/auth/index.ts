import { resolveAuthProvider } from '@/lib/authProvider'
import { clerkAdapter } from './clerk'
import type { AuthAdapter } from './types'

// Server-side entry (proxy, root layout, sign-in/up routes). Selected per call
// from the runtime AUTH_PROVIDER, never at build time. Client code reads the
// neutral context from './context' instead.
export function getAuthAdapter(): AuthAdapter {
  switch (resolveAuthProvider(process.env.AUTH_PROVIDER)) {
    case 'clerk':
      return clerkAdapter
  }
}
