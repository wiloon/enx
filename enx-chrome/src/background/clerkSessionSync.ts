// Classifies a loaded Clerk client's session sync (#688) at the network
// boundary. clerk-js 6 resolves load() with no session and no error when its
// Frontend API request fails while it cannot see an online navigator (an
// offline MV3 worker), so an empty client proves nothing on its own. One
// read of the client, watched through the instance's own after-response
// hook, proves a signed-out client only when Clerk's Frontend API answered
// it with a 2xx and no signed-in session.

import { classifySessionSync, type SessionSync } from '@/lib/sessionSync'

type ClientReadRequest = { method?: string; path?: string }
type ClientReadResponse = { ok: boolean; payload: unknown }

export interface LoadedClerk {
  session: unknown
  client?: { reload(): Promise<unknown> } | null
  __internal_onAfterResponse(
    callback: (
      request: ClientReadRequest,
      response?: ClientReadResponse
    ) => unknown
  ): void
}

const SIGNED_IN_STATUSES = new Set(['active', 'pending'])

const holdsNoSignedInSession = (payload: unknown): boolean => {
  const client = (payload as { response?: unknown } | null)?.response as {
    sessions?: Array<{ status?: string }>
  } | null
  return !(client?.sessions ?? []).some(session =>
    SIGNED_IN_STATUSES.has(session.status ?? '')
  )
}

const readSignedOutClient = async (clerk: LoadedClerk): Promise<boolean> => {
  // clerk-js swallows a failed read while offline; don't spend one.
  if (globalThis.navigator?.onLine === false || !clerk.client) return false
  let signedOut = false
  let watching = true
  clerk.__internal_onAfterResponse((request, response) => {
    if (!watching || request.method !== 'GET' || request.path !== '/client')
      return
    signedOut =
      Boolean(response?.ok) && holdsNoSignedInSession(response?.payload)
  })
  try {
    await clerk.client.reload()
  } catch {
    return false
  } finally {
    watching = false
  }
  return signedOut
}

export const classifyLoadedClerk = async (
  clerk: LoadedClerk
): Promise<SessionSync> => {
  const hasSession = Boolean(clerk.session)
  return classifySessionSync({
    loaded: true,
    hasSession,
    signedOutReadSucceeded: !hasSession && (await readSignedOutClient(clerk)),
  })
}
