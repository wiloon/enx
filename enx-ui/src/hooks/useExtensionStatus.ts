'use client'

import { useEffect, useState } from 'react'
import { detectExtension } from '@/lib/enxExtension'

// ADR-019: whether the ENX Chrome extension is available to this page.
// 'unknown' until the check resolves; the Reader page shows its install
// prompt only on 'not-installed'.
export type ExtensionStatus = 'unknown' | 'installed' | 'not-installed'

export function useExtensionStatus(): ExtensionStatus {
  const [status, setStatus] = useState<ExtensionStatus>('unknown')

  useEffect(() => {
    let cancelled = false
    detectExtension().then(({ installed }) => {
      if (!cancelled) setStatus(installed ? 'installed' : 'not-installed')
    })
    return () => {
      cancelled = true
    }
  }, [])

  return status
}
