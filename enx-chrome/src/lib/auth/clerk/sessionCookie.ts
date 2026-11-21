import type { SessionCookieChangeInfo } from '@/lib/auth/types'

/** Clerk session cookie names the worker watches for account changes. */
export const isClerkSessionCookieName = (name: string): boolean =>
  /^__(client|client_uat|clerk_db_jwt)(_|$)/.test(name)

export const matchesClerkSessionCookie = (
  syncHost: string,
  change: SessionCookieChangeInfo
): boolean => {
  const host = new URL(syncHost).hostname
  const domain = change.cookie.domain.replace(/^\./, '')
  if (host !== domain && !host.endsWith(`.${domain}`)) return false
  if (!isClerkSessionCookieName(change.cookie.name)) return false
  if (change.removed && change.cause === 'overwrite') return false
  return true
}

export const registerClerkSessionCookieListener = (
  cookies: {
    onChanged: {
      addListener: (
        listener: (
          change: SessionCookieChangeInfo
        ) => void | Promise<void>
      ) => void
    }
  },
  syncHost: string,
  onChange: (change: SessionCookieChangeInfo) => void | Promise<void>
): void => {
  cookies.onChanged.addListener(change => {
    if (!matchesClerkSessionCookie(syncHost, change)) return
    return onChange(change)
  })
}
