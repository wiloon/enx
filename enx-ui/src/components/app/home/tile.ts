import { cn } from '@/lib/utils'

// Home is made of whole-card links, not cards with buttons inside them
// (ADR-027 decision 2): the click target is the entire tile and the brand
// colour shows up on hover instead of as a solid button.
export const tileClass = cn(
  'group relative flex flex-col rounded-lg border bg-card p-4 text-card-foreground',
  'transition-colors hover:border-brand/40 hover:shadow-sm'
)
