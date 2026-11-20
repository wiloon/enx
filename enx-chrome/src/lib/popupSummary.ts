import type { BillingInputs } from '@/lib/creditNotice'

/**
 * What GET_POPUP_SUMMARY returns (ADR-052 Decision 3). Each half is null
 * when its own request failed; the other half still arrives.
 */
export interface PopupSummary {
  stats: {
    wordsReadThisWeek: number
    vocabTotal: number
    vocabMastered: number
  } | null
  billing: BillingInputs | null
}
