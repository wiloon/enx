import type { AuthSubject } from '@/lib/auth/types'

/** Clerk's stable subject is exactly `user.id` (ADR-032 / ADR-081). */
export const clerkSubject = (client: {
  session: unknown
  user?: { id: string } | null
}): AuthSubject | null => (client.session ? (client.user?.id ?? null) : null)
