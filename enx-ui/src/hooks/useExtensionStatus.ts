'use client'

import { useEffect, useState } from 'react'
import { pingExtension } from '@/lib/enxExtension'

// ADR-019: whether the ENX Chrome extension is available to this page.
// 'unknown' until the check resolves; the Reader page shows its install
// prompt only on 'not-installed'.
export type ExtensionStatus = 'unknown' | 'installed' | 'not-installed'

export function useExtensionStatus(): ExtensionStatus {
  const [status, setStatus] = useState<ExtensionStatus>('unknown')

  useEffect(() => {
    // Fast path: the content script stamps the running version onto <html>
    // on enx-ui pages (ADR-019 Option G2), so we can skip the ping round-trip.
    if (
      typeof document !== 'undefined' &&
      document.documentElement.dataset.enxExtension
    ) {
      setStatus('installed')
      return
    }

    let cancelled = false
    pingExtension().then(({ installed }) => {
      if (!cancelled) setStatus(installed ? 'installed' : 'not-installed')
    })
    return () => {
      cancelled = true
    }
  }, [])

  return status
}
