// A local copy of which pages this user has saved (ADR-032 Decision 4a), so the
// popup can show "Saved" for the page in front of it without ever sending
// that page's address to enx-api. Written on every save and remove made from
// this browser; enx-api stays the source of truth.

// Stored per Clerk user, so a different account signing in on the same
// browser never sees someone else's saved state.
export const storageKeyFor = (userId: string) => `savedPages:${userId}`

export interface SavedPageRef {
  /** enx-api's id for the saved page, needed to remove it. */
  id: string
  /** The address enx-api stored (normalized). */
  url: string
}

type SavedPagesMap = Record<string, SavedPageRef>

// Mirrors enx-api urlnorm.isTrackingParam: these say how the user arrived,
// not which page it is.
function isTrackingParam(key: string, onX: boolean): boolean {
  key = key.toLowerCase()
  if (onX && (key === 's' || key === 't')) return true
  return (
    key.startsWith('utm_') ||
    key.startsWith('mc_') ||
    key === 'fbclid' ||
    key === 'gclid'
  )
}

const X_HOST = /(^|\.)(x|twitter)\.com$/

// savedPageKey reduces a URL to the form used to match the open tab against
// saved pages. It follows the same rules as enx-api's urlnorm.ForSave (no
// fragment, no credentials, no tracking parameters), but it is only ever
// compared with itself: the key of the tab's URL against the key of the URL
// enx-api returned. So a difference in how Go and the browser serialize a URL
// cannot cause a mismatch. Returns null for anything that cannot be saved.
export function savedPageKey(raw: string | undefined): string | null {
  if (!raw) return null
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  u.username = ''
  u.password = ''
  u.hash = ''
  const onX = X_HOST.test(u.hostname)
  const kept = u.search
    .slice(1)
    .split('&')
    .filter(pair => pair !== '' && !isTrackingParam(pair.split('=')[0], onX))
  u.search = kept.length ? `?${kept.join('&')}` : ''
  return u.toString()
}

async function readMap(userId: string): Promise<SavedPagesMap> {
  const key = storageKeyFor(userId)
  const stored = await chrome.storage.local.get(key)
  const map = stored?.[key]
  return map && typeof map === 'object' ? (map as SavedPagesMap) : {}
}

async function writeMap(userId: string, map: SavedPagesMap): Promise<void> {
  await chrome.storage.local.set({ [storageKeyFor(userId)]: map })
}

/** The saved page matching tabUrl, if this browser knows it is saved. */
export async function findSavedPage(
  userId: string,
  tabUrl: string | undefined
): Promise<SavedPageRef | null> {
  const key = savedPageKey(tabUrl)
  if (!key) return null
  return (await readMap(userId))[key] ?? null
}

/**
 * Records a save. Keyed by both the address enx-api stored and the tab's own
 * address, so the tab matches even where the two differ in a way the key
 * does not smooth over.
 */
export async function rememberSavedPage(
  userId: string,
  tabUrl: string,
  page: SavedPageRef
): Promise<void> {
  const map = await readMap(userId)
  for (const raw of [page.url, tabUrl]) {
    const key = savedPageKey(raw)
    if (key) map[key] = page
  }
  await writeMap(userId, map)
}

/** Forgets every entry for the saved page with this id. */
export async function forgetSavedPage(
  userId: string,
  id: string
): Promise<void> {
  const map = await readMap(userId)
  const kept = Object.fromEntries(
    Object.entries(map).filter(([, ref]) => ref.id !== id)
  )
  await writeMap(userId, kept)
}
