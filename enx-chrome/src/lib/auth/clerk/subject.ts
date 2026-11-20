import type { AuthClient, AuthSubject } from '@/lib/auth/types'

/** Clerk's stable subject is exactly `user.id` (ADR-032 / ADR-081). */
export const clerkSubject = (client: AuthClient): AuthSubject | null =>
  client.session ? (client.user?.id ?? null) : null
