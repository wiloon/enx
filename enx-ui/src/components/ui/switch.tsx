'use client'

import * as React from 'react'

import { cn } from '@/lib/utils'

type SwitchProps = Omit<
  React.ComponentProps<'button'>,
  'onChange' | 'role' | 'type'
> & {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}

// A toggle for a setting that takes effect immediately. A plain
// <button role="switch"> keeps the page free of another Radix dependency;
// the label comes from an associated <Label htmlFor> or aria-label.
function Switch({
  checked,
  onCheckedChange,
  className,
  disabled,
  ...props
}: SwitchProps) {
  return (
    <button
      {...props}
      type="button"
      role="switch"
      aria-checked={checked}
      data-state={checked ? 'checked' : 'unchecked'}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-transparent transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-primary' : 'bg-input',
        className
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none block h-5 w-5 rounded-full bg-background shadow transition-transform',
          checked ? 'translate-x-5' : 'translate-x-0.5'
        )}
      />
    </button>
  )
}

export { Switch }
