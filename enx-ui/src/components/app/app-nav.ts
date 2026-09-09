import {
  BarChart3,
  BookOpen,
  CreditCard,
  Home,
  Search,
  Sparkles,
  Wrench,
  type LucideIcon,
} from 'lucide-react'

// Single source of truth for the app-shell navigation (ADR-016). Adding a
// section is one entry here — the sidebar, the mobile drawer and the topbar
// title all read from these arrays.
export type NavItem = {
  label: string
  href: string
  icon: LucideIcon
}

// Primary destinations.
export const NAV_MAIN: NavItem[] = [
  { label: 'Home', href: '/app', icon: Home },
  { label: 'Word Lookup', href: '/lookup', icon: Search },
  { label: 'Rephrase', href: '/rephrase', icon: Sparkles },
  { label: 'Reader', href: '/reader', icon: BookOpen },
]

// Reading insights — daily / weekly / monthly stats and charts live under here
// as they land.
export const NAV_INSIGHTS: NavItem[] = [
  { label: 'Reading Stats', href: '/stats', icon: BarChart3 },
]

// Account / utility items, pinned to the bottom of the sidebar so they don't
// compete with the primary navigation.
export const NAV_FOOTER: NavItem[] = [
  { label: 'Billing', href: '/billing', icon: CreditCard },
]

// Admin-only tools (ADR-021). Rendered in the sidebar only when
// useIsAdmin() is true; the routes underneath are gated by
// (app)/admin/layout.tsx on the client and RequireAdmin on the server.
export const NAV_ADMIN: NavItem[] = [
  { label: 'Dictionary', href: '/admin/dictionary', icon: Wrench },
]

export const ALL_NAV: NavItem[] = [
  ...NAV_MAIN,
  ...NAV_INSIGHTS,
  ...NAV_FOOTER,
  ...NAV_ADMIN,
]

// True when `pathname` is `item.href` or a nested route beneath it, so
// /stats/weekly still lights up "Reading Stats".
export function isNavItemActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + '/')
}

// The label to show in the topbar for the current route (longest matching
// href wins), falling back to the product name.
export function navTitleForPath(pathname: string): string {
  const match = [...ALL_NAV]
    .filter((item) => isNavItemActive(pathname, item.href))
    .sort((a, b) => b.href.length - a.href.length)[0]
  return match?.label ?? 'Catseye'
}
