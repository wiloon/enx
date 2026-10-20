// ADR-047 Decision 1: what the extension does with the /welcome page when it
// is installed. A user who came from /welcome and installed from the store
// still has that tab open, so it is brought back instead of opening a second
// one. The background passes in the open tabs and carries out the result.

export interface TabInfo {
  id?: number
  windowId?: number
  url?: string
}

export type WelcomeTabAction =
  | { kind: 'none' }
  | { kind: 'open'; url: string }
  | { kind: 'focus'; tabId: number; windowId: number }

export const welcomeUrlPattern = (uiOrigin: string): string =>
  `${uiOrigin}/welcome*`

const isWelcomePage = (url: string | undefined, uiOrigin: string): boolean => {
  if (!url) return false
  try {
    const parsed = new URL(url)
    return parsed.origin === uiOrigin && parsed.pathname === '/welcome'
  } catch {
    return false
  }
}

export function welcomeTabAction(
  reason: string,
  uiOrigin: string,
  tabs: TabInfo[]
): WelcomeTabAction {
  if (reason !== 'install') return { kind: 'none' }
  const existing = tabs.find(
    tab =>
      tab.id !== undefined &&
      tab.windowId !== undefined &&
      isWelcomePage(tab.url, uiOrigin)
  )
  if (existing) {
    return {
      kind: 'focus',
      tabId: existing.id!,
      windowId: existing.windowId!,
    }
  }
  return { kind: 'open', url: `${uiOrigin}/welcome?src=install` }
}
