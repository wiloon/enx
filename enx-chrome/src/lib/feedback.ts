// The popup's "Send feedback" (ADR-076): the user's own words, the cleaned
// page URL they may edit or clear, and a little context. Never page text, a
// title or a screenshot. The text rules mirror enx-ui's feedback.ts and
// feedback.textRecord in enx-api, which trims with Go's strings.TrimSpace
// and counts code points.

import type { ArticleChoiceStatus } from '@/lib/articleChoice'

export const FEEDBACK_MAX_LENGTH = 2000

export const FEEDBACK_SENT_MESSAGE = 'Thanks — feedback sent'

export const FEEDBACK_FAILED_MESSAGE =
  'Could not send the feedback. Please try again.'

/** What the tab's content script knows about the page. */
export interface PageFeedbackContext {
  learningMode: boolean
  adapter?: string
  articleSource?: 'auto' | 'user'
}

/** What the popup sends; the background worker adds appVersion. */
export interface FeedbackContext extends PageFeedbackContext {
  browser: string
}

export interface FeedbackSubmission {
  text: string
  url: string
  context: FeedbackContext
}

/**
 * The page's half of the context. With learning mode off there is no
 * article, so nothing but that. The adapter only found the article when the
 * user did not choose it.
 */
export function pageFeedbackContext({
  learningMode,
  adapter,
  choice,
}: {
  learningMode: boolean
  adapter: string
  choice: ArticleChoiceStatus['source']
}): PageFeedbackContext {
  if (!learningMode) return { learningMode }
  return choice === 'your-choice'
    ? { learningMode, articleSource: 'user' }
    : { learningMode, adapter, articleSource: 'auto' }
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

export type FeedbackOutcome = { sent: true } | { sent: false; message: string }

type SendToBackground = (message: {
  type: 'submitFeedback'
  feedback: FeedbackSubmission
}) => Promise<{ success?: boolean; status?: number; error?: string } | undefined>

/**
 * Sends the feedback through the background worker, which holds the
 * session. A refusal (400, 429) shows the API's own message; a server or
 * network failure, which has no message meant for the user, the fallback.
 */
export async function sendFeedback(
  send: SendToBackground,
  feedback: FeedbackSubmission
): Promise<FeedbackOutcome> {
  try {
    const response = await send({ type: 'submitFeedback', feedback })
    if (response?.success) return { sent: true }
    const status = response?.status
    if (status && status >= 400 && status < 500 && response?.error) {
      return { sent: false, message: response.error }
    }
  } catch {
    // The background never answered: the same as a network failure.
  }
  return { sent: false, message: FEEDBACK_FAILED_MESSAGE }
}
