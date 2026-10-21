import { Repeat } from 'lucide-react'

// How many times the reader has looked a word up (ADR-011): the same icon,
// bare number and wording as the extension's word popover and Side Panel
// card. The words stay for hover and screen readers.
export default function LookupCount({ count }: { count: number }) {
  const label = `Looked up ${count} ${count === 1 ? 'time' : 'times'}`
  return (
    <span className="inline-flex items-center gap-1 tabular-nums" title={label}>
      <Repeat className="size-3" aria-hidden="true" />
      <span aria-hidden="true">{count}</span>
      <span className="sr-only">{label}</span>
    </span>
  )
}
