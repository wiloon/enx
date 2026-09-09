'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { SITE } from '@/lib/site'
import { cn } from '@/lib/utils'
import { useIsAdmin } from '@/hooks/useIsAdmin'
import {
  NAV_ADMIN,
  NAV_FOOTER,
  NAV_INSIGHTS,
  NAV_MAIN,
  type NavItem,
  isNavItemActive,
} from './app-nav'

function NavLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem
  active: boolean
  onNavigate?: () => void
}) {
  const Icon = item.icon
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
          : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
      )}
    >
      <Icon aria-hidden className="h-4 w-4 shrink-0" />
      {item.label}
    </Link>
  )
}

// The app-shell primary navigation (ADR-016). Rendered both as the fixed
// desktop rail and inside the mobile drawer; `onNavigate` lets the drawer
// close itself on selection.
export default function AppSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname()
  const { isAdmin } = useIsAdmin()

  const renderGroup = (items: NavItem[]) =>
    items.map((item) => (
      <NavLink
        key={item.href}
        item={item}
        active={isNavItemActive(pathname, item.href)}
        onNavigate={onNavigate}
      />
    ))

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-14 items-center border-b border-sidebar-border px-4">
        <Link
          href={SITE.appPath}
          onClick={onNavigate}
          className="flex items-center gap-2 font-semibold"
        >
          <span
            aria-hidden
            className="inline-block h-5 w-5 rounded-full bg-brand ring-2 ring-brand/25"
          />
          {SITE.name}
        </Link>
      </div>

      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
        {renderGroup(NAV_MAIN)}

        <div className="my-2 border-t border-sidebar-border" />
        {renderGroup(NAV_INSIGHTS)}

        {isAdmin && (
          <>
            <div className="my-2 border-t border-sidebar-border" />
            <p className="px-3 pb-1 text-xs font-medium uppercase tracking-wide text-sidebar-foreground/50">
              Admin
            </p>
            {renderGroup(NAV_ADMIN)}
          </>
        )}

        <div className="mt-auto flex flex-col gap-1 pt-2">
          <div className="mb-1 border-t border-sidebar-border" />
          {renderGroup(NAV_FOOTER)}
        </div>
      </nav>
    </div>
  )
}
