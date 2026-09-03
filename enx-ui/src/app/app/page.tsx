import AuthWrapper from '@/components/AuthWrapper'

// The app entry (ADR-013): login-gated dashboard. The marketing landing page
// is at "/".
export default function AppHome() {
  return <AuthWrapper />
}
