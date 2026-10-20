'use client'

import { useEffect, useState } from 'react'
import { extensionStatus, type StatusResult } from '@/lib/enxExtension'
import { extensionStatusSettled } from '@/lib/onboarding'

const same = (a: StatusResult | undefined, b: StatusResult) =>
  a?.installed === b.installed && a?.isOnToolbar === b.isOnToolbar

// ADR-047 Decision 2: /welcome asks the extension every couple of seconds
// while the page is visible, so installing or pinning ticks its step without
// a reload. Asks nothing while `enabled` is false, and stops once nothing it
// watches can change (see extensionStatusSettled). Undefined until the first
// answer.
export function useExtensionStatusPoll({
  enabled = true,
  watchToolbar = true,
  intervalMs = 2000,
}: {
  enabled?: boolean
  watchToolbar?: boolean
  intervalMs?: number
} = {}): StatusResult | undefined {
  const [status, setStatus] = useState<StatusResult>()

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const tick = async () => {
      if (document.visibilityState !== 'hidden') {
        const answer = await extensionStatus()
        if (cancelled) return
        // The content script's stamp (ADR-019) also proves the install.
        const next = {
          ...answer,
          installed:
            answer.installed ||
            Boolean(document.documentElement.dataset.enxExtension),
        }
        setStatus((prev) => (same(prev, next) ? prev : next))
        if (extensionStatusSettled(next, watchToolbar)) return
      }
      timer = setTimeout(tick, intervalMs)
    }
    void tick()

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [enabled, watchToolbar, intervalMs])

  return status
}
