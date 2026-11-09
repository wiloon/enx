// The "Send feedback" rules (ADR-076). Mirrors feedback.textRecord in
// enx-api, which trims with Go's strings.TrimSpace and counts code points.

export const FEEDBACK_MAX_LENGTH = 2000

export const FEEDBACK_SENT_MESSAGE = 'Thanks — feedback sent'

export const FEEDBACK_FAILED_MESSAGE =
  'Could not send the feedback. Please try again.'

// What enx-ui attaches to written feedback: it has no learning mode, adapter
// or article source, which only the extension knows.
export interface FeedbackContext {
  appVersion: string
  browser: string
}

export interface FeedbackSubmission {
  text: string
  url: string
  context: FeedbackContext
}

/** The context sent with feedback; "unknown" stands in for a dev server's missing version. */
export function feedbackContext(
  appVersion: string,
  browser: string
): FeedbackContext {
  return { appVersion: appVersion || 'unknown', browser }
}

const codePoints = (text: string) => [...text]

/** Cuts the text at the limit, so typing or pasting stops there. */
export function clampFeedbackText(text: string): string {
  const chars = codePoints(text)
  return chars.length > FEEDBACK_MAX_LENGTH
    ? chars.slice(0, FEEDBACK_MAX_LENGTH).join('')
    : text
}

export function feedbackRemaining(text: string): number {
  return FEEDBACK_MAX_LENGTH - codePoints(text).length
}

// Unicode White_Space is the set Go's unicode.IsSpace trims.
export function isFeedbackBlank(text: string): boolean {
  return /^\p{White_Space}*$/u.test(text)
}

/**
 * The message for a failed send: the API's own for a refusal (400, 429),
 * the fallback for a server or network failure.
 */
export function feedbackFailureMessage(
  status: number | undefined,
  error: string | undefined
): string {
  if (status && status >= 400 && status < 500 && error) return error
  return FEEDBACK_FAILED_MESSAGE
}
