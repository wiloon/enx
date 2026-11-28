/**
 * Fetches the popup summary on every open (ADR-052 Decision 5) and renders
 * PopupStatsCard. Signed-in only — the parent mounts this inside SignedInBody.
 */

import { useEffect, useState } from 'react'
import PopupStatsCard from '@/components/PopupStatsCard'
import { sendToBackground } from '@/lib/messaging'
import type { PopupSummary } from '@/lib/popupSummary'

export default function PopupStatsSection() {
  const [summary, setSummary] = useState<PopupSummary | null>(null)

  useEffect(() => {
    let cancelled = false
    sendToBackground({ type: 'GET_POPUP_SUMMARY' })
      .then((response: PopupSummary) => {
        if (!cancelled) setSummary(response)
      })
      .catch(() => {
        if (!cancelled) setSummary({ stats: null, billing: null })
      })
    return () => {
      cancelled = true
    }
  }, [])

  return <PopupStatsCard summary={summary} />
}
