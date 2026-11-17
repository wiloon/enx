// Pure rule: does this click start a client navigation that should show the
// site-wide progress bar? The bar component stays thin; every exclusion lives
// here so unit tests cover it on plain inputs.

export const NAVIGATION_PROGRESS_SHOW_DELAY_MS = 150
export const NAVIGATION_PROGRESS_BACKSTOP_MS = 15_000

export type NavigationProgressClick = {
  button: number
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  currentUrl: string
  href: string
  target: string
  download: boolean
  noProgress: boolean
}

export function shouldStartNavigationProgress(
  click: NavigationProgressClick
): boolean {
  if (click.button !== 0) return false
  if (click.metaKey || click.ctrlKey || click.shiftKey || click.altKey)
    return false
  if (click.noProgress) return false
  if (click.download) return false

  const target = click.target.trim().toLowerCase()
  if (target && target !== '_self') return false

  let current: URL
  let next: URL
  try {
    current = new URL(click.currentUrl)
    next = new URL(click.href, current)
  } catch {
    return false
  }

  if (next.origin !== current.origin) return false

  const currentRoute = current.pathname + current.search
  const nextRoute = next.pathname + next.search
  if (currentRoute === nextRoute) return false

  return true
}
