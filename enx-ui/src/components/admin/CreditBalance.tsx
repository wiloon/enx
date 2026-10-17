import { cn } from '@/lib/utils'

// A credit balance on the admin users pages. Below zero (a clawback or an
// admin deduction, ADR-049 Decision 3) it turns red, and says so to screen
// readers and on hover. `relative` holds the absolutely positioned sr-only
// text inside any scrolling table; without it the text escapes the scroll box
// and widens the page on a phone.
export default function CreditBalance({
  value,
  className,
}: {
  value: number
  className?: string
}) {
  if (value >= 0) {
    return <span className={cn('tabular-nums', className)}>{value}</span>
  }
  return (
    <span
      title="Negative balance"
      className={cn(
        'relative font-semibold tabular-nums text-destructive',
        className
      )}
    >
      {value}
      <span className="sr-only">Negative balance</span>
    </span>
  )
}
