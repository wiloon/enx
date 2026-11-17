import { MousePointerClick } from 'lucide-react'

/** A picture of the popup button, not an interactive control. */
export function ReadWithCatglishChip() {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-brand px-2 py-1 align-middle text-xs font-semibold text-brand-foreground">
      <MousePointerClick aria-hidden="true" className="size-4" />
      Read with Catglish
    </span>
  )
}
