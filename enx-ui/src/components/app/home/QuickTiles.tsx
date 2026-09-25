import Link from 'next/link'
import { BookOpen, ChevronRight, Search, Sparkles } from 'lucide-react'
import { tileClass } from './tile'

// The compact feature entries. They used to be the whole of /app as four
// full-width cards with a solid button each; ADR-027 demotes them to the
// fourth row, because the sidebar already navigates and Home is about the
// user's own state.
const TILES = [
  { label: 'Word Lookup', href: '/lookup', icon: Search },
  { label: 'Rephrase', href: '/rephrase', icon: Sparkles },
  { label: 'Reader', href: '/reader', icon: BookOpen },
]

export default function QuickTiles() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {TILES.map(({ label, href, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className={`${tileClass} flex-row items-center gap-3`}
        >
          <Icon aria-hidden className="size-4 shrink-0 text-brand" />
          <span className="text-sm font-medium">{label}</span>
          <ChevronRight
            aria-hidden
            className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
          />
        </Link>
      ))}
    </div>
  )
}
