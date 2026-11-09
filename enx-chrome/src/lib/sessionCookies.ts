// The session cookies the worker has seen change (#743). The website's Clerk
// rewrites them every second or so with the values they already hold (a
// removal by an expired overwrite, then a set), so a burst of changes matters
// only when it leaves the cookies different from what the last sync saw.

export interface SessionCookieChange {
  removed: boolean
  cookie: { domain: string; path?: string; name: string; value?: string }
}

export function createSessionCookies() {
  const values = new Map<string, string | undefined>()
  return {
    record: ({ removed, cookie }: SessionCookieChange) => {
      const key = `${cookie.domain}|${cookie.path ?? ''}|${cookie.name}`
      if (removed) values.delete(key)
      else values.set(key, cookie.value)
    },
    // Equal snapshots mean the same cookies with the same values.
    snapshot: () =>
      JSON.stringify([...values].sort(([a], [b]) => a.localeCompare(b))),
  }
}
