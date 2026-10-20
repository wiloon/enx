'use client'

import { useEffect, useState } from 'react'
import { extensionStatus, type StatusResult } from '@/lib/enxExtension'

const same = (a: StatusResult | undefined, b: StatusResult) =>
  a?.installed === b.installed && a?.isOnToolbar === b.isOnToolbar

// ADR-047 Decision 2: /welcome asks the extension every couple of seconds
// while the page is visible, so installing or pinning ticks its step without
// a reload. Stops once both are true; undefined until the first answer.
export function useExtensionStatusPoll(
  intervalMs = 2000
): StatusResult | undefined {
  const [status, setStatus] = useState<StatusResult>()

  useEffect(() => {
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
        if (next.installed && next.isOnToolbar) return
      }
      timer = setTimeout(tick, intervalMs)
    }
    void tick()

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [intervalMs])

  return status
}
