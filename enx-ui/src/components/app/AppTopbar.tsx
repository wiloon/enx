'use client'

import { Menu } from 'lucide-react'
import AccountMenu from './AccountMenu'

// App-shell top bar (ADR-016): the drawer toggle on mobile, the account menu
// on the right. No page title: each page names itself with PageHeader, and
// the sidebar marks where you are (ADR-016, 2026-10-15 note).
export default function AppTopbar({
  onOpenSidebar,
}: {
  onOpenSidebar: () => void
}) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border/60 bg-background/80 px-4 backdrop-blur sm:px-6">
      <button
        type="button"
        onClick={onOpenSidebar}
        aria-label="Open navigation"
        className="rounded-md p-1.5 text-foreground/70 hover:bg-accent hover:text-foreground md:hidden"
      >
        <Menu aria-hidden className="h-5 w-5" />
      </button>

      <div className="ml-auto flex items-center gap-3">
        <AccountMenu />
      </div>
    </header>
  )
}
