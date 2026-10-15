import type { ReactNode } from 'react'

// The top of every app page: its one <h1>, an optional line on what the page
// is for, and optional actions on the right. The app-shell top bar shows no
// title, so this is where a page says what it is (ADR-016, 2026-10-15 note).
// Use the page's sidebar label as the title, so the two always agree.
export default function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div className="min-w-0 space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
    </div>
  )
}
