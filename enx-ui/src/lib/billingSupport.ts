// The billing-support message rule and answer shape. Mirrors
// conflict.RequestSupport in enx-api, which trims with Go's strings.TrimSpace
// and counts with utf8.RuneCountInString.

export const BILLING_SUPPORT_MAX_LENGTH = 2000

// The counter shows from 90% of the limit (docs/agents/ui-design.md).
export const BILLING_SUPPORT_NEAR_LIMIT = BILLING_SUPPORT_MAX_LENGTH * 0.9

export const BILLING_SUPPORT_FAILED_MESSAGE =
  'Your message could not be sent right now. Please try again later.'

// Unicode White_Space is the set Go's unicode.IsSpace trims. JavaScript's
// .trim() differs: it drops U+FEFF and keeps U+0085.
function trimSpace(text: string): string {
  return text.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '')
}

// Length in Unicode code points of the trimmed message.
export function supportMessageLength(text: string): number {
  return [...trimSpace(text)].length
}

export function supportMessageStatus(text: string): {
  length: number
  blank: boolean
  overLimit: boolean
} {
  const length = supportMessageLength(text)
  return {
    length,
    blank: length === 0,
    overLimit: length > BILLING_SUPPORT_MAX_LENGTH,
  }
}

export interface BillingSupportAnswer {
  message: string
  supportRequest: { message: string; sentAt: string }
}

// The 200 body of POST /api/billing/support, or null when it lacks the
// stored request the reader is shown.
export function parseBillingSupportAnswer(
  body: unknown
): BillingSupportAnswer | null {
  if (!body || typeof body !== 'object') return null
  const { message, supportRequest } = body as Record<string, unknown>
  if (!supportRequest || typeof supportRequest !== 'object') return null
  const sent = supportRequest as Record<string, unknown>
  if (typeof sent.message !== 'string' || typeof sent.sentAt !== 'string') {
    return null
  }
  return {
    message: typeof message === 'string' ? message : '',
    supportRequest: { message: sent.message, sentAt: sent.sentAt },
  }
}
