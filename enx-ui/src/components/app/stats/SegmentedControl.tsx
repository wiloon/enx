'use client'

import { cn } from '@/lib/utils'

// A row of mutually exclusive choices. Used for the two switches above the
// stats chart -- which bucket size, and which measure -- so that one chart
// answers what used to be several static blocks.
//
// Built on real radio semantics rather than styled buttons: the group reads
// as one control to a screen reader, and arrow keys move between options for
// free.
export default function SegmentedControl<T extends string>({
  name,
  label,
  value,
  options,
  onChange,
}: {
  name: string
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex rounded-lg border bg-muted/40 p-0.5"
    >
      {options.map((option) => {
        const selected = option.value === value
        return (
          <label
            key={option.value}
            className={cn(
              'cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              selected
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={selected}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        )
      })}
    </div>
  )
}
