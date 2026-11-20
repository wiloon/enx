/**
 * Popup stats card (ADR-052): words read this week, words saved, and a
 * credit notice only when credits are running low. Fixed height so filling
 * in numbers (and the notice) does not shift the learning-mode switch.
 */

import { approximateWords } from '@/lib/approximateWords'
import { creditNotice } from '@/lib/creditNotice'
import type { PopupSummary } from '@/lib/popupSummary'
import { config } from '@/config/env'

// Two figure cells plus a one-line notice slot. Kept as a constant class so
// loading and loaded states share one height (ADR-052 Decision 4). Compact
// enough that the tallest popup layout still fits under Chrome's 600px cap.
const CARD_HEIGHT = 'h-[3.25rem]'

interface PopupStatsCardProps {
  /** null while the GET_POPUP_SUMMARY reply is outstanding. */
  summary: PopupSummary | null
  /** Injected clock for creditNotice; defaults to now. */
  now?: Date
}

function formatExact(n: number): string {
  return n.toLocaleString('en-US')
}

export default function PopupStatsCard({
  summary,
  now = new Date(),
}: PopupStatsCardProps) {
  const base = config.frontendBaseUrl
  const stats = summary?.stats ?? null
  const billing = summary?.billing ?? null
  const notice = billing ? creditNotice(billing, now) : null

  const wordsReadDisplay = stats
    ? approximateWords(stats.wordsReadThisWeek)
    : '—'
  const wordsReadLabel = stats
    ? `About ${approximateWords(stats.wordsReadThisWeek)} words read this week (estimated from reading position)`
    : 'Words read this week'
  const vocabDisplay = stats ? formatExact(stats.vocabTotal) : '—'
  const vocabLabel = stats
    ? `${formatExact(stats.vocabTotal)} words saved`
    : 'Words saved'

  return (
    <div
      data-testid="popup-stats-card"
      className={`flex ${CARD_HEIGHT} flex-col justify-between rounded-xl bg-background px-2 py-1 shadow-xs ring-1 ring-border`}
    >
      <div className="grid grid-cols-2 gap-1">
        <a
          href={`${base}/stats`}
          target="_blank"
          rel="noopener noreferrer"
          title={wordsReadLabel}
          aria-label={wordsReadLabel}
          className="min-w-0 rounded-md px-1 transition hover:bg-muted"
        >
          <span className="block truncate text-sm font-semibold leading-tight text-foreground tabular-nums">
            {wordsReadDisplay}
          </span>
          <span className="block truncate text-[10px] leading-tight text-muted-foreground">
            words read this week
          </span>
        </a>
        <a
          href={`${base}/words`}
          target="_blank"
          rel="noopener noreferrer"
          title={vocabLabel}
          aria-label={vocabLabel}
          className="min-w-0 rounded-md px-1 transition hover:bg-muted"
        >
          <span className="block truncate text-sm font-semibold leading-tight text-foreground tabular-nums">
            {vocabDisplay}
          </span>
          <span className="block truncate text-[10px] leading-tight text-muted-foreground">
            words saved
            {stats ? (
              <span className="text-muted-foreground/80">
                {' '}
                · {formatExact(stats.vocabMastered)} mastered
              </span>
            ) : null}
          </span>
        </a>
      </div>

      <div className="h-3 min-h-3">
        {notice ? (
          <a
            href={`${base}${notice.href}`}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="popup-stats-credit-notice"
            className="block truncate text-[10px] font-medium leading-3 text-warning-foreground underline-offset-2 hover:underline"
          >
            {notice.text}
          </a>
        ) : null}
      </div>
    </div>
  )
}
