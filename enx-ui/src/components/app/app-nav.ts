import {
  AlertTriangle,
  BarChart3,
  Bookmark,
  BookText,
  ClipboardCheck,
  FileText,
  Gift,
  Globe,
  Home,
  Search,
  Settings,
  Sparkles,
  Users,
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
  { label: 'Reader', href: '/reader', icon: FileText },
  // The words looked up in articles (user_dicts), and the pages saved from
  // the extension popup (ADR-032).
  { label: 'Word List', href: '/words', icon: BookText },
  { label: 'Saved Pages', href: '/saved', icon: Bookmark },
]

// Reading insights — daily / weekly / monthly stats and charts live under here
// as they land.
export const NAV_INSIGHTS: NavItem[] = [
  { label: 'Reading Stats', href: '/stats', icon: BarChart3 },
]

// Utility items, pinned to the bottom of the sidebar so they don't compete
// with the primary navigation. Account and Billing live in the top bar's
// account menu (#211).
export const NAV_FOOTER: NavItem[] = [
  { label: 'Settings', href: '/settings', icon: Settings },
  // Invite links (ADR-051 Decision 8).
  { label: 'Invite friends', href: '/invite', icon: Gift },
  // Back to the marketing site (ADR-027 decision 4). Same Next.js app, so it
  // is a plain in-app link, not an external one.
  { label: 'Back to site', href: '/', icon: Globe },
]

// Admin-only tools (ADR-021). Rendered in the sidebar only when
// useIsAdmin() is true; the routes underneath are gated by
// (app)/admin/layout.tsx on the client and RequireAdmin on the server.
export const NAV_ADMIN: NavItem[] = [
  { label: 'Dictionary', href: '/admin/dictionary', icon: Wrench },
  // AI-made definitions waiting for review (ADR-045).
  { label: 'AI definitions', href: '/admin/ai-words', icon: ClipboardCheck },
  { label: 'Page reports', href: '/admin/page-reports', icon: AlertTriangle },
  // Accounts, balances and the credit ledger (ADR-049).
  { label: 'Users', href: '/admin/users', icon: Users },
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
  // '/' is a prefix of every route, so the generic startsWith() rule would
  // light up "Back to site" everywhere. Only an exact match counts.
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(href + '/')
}
