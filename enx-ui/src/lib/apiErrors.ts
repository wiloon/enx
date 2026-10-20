import { LEGAL } from '@/lib/legal'

// What a reader sees when an enx-api call fails. Every message here must give
// them something to do; a raw status or a server-internal string does not.

export const SESSION_EXPIRED_MESSAGE =
  'Your session has expired. Refresh the page to sign in again.'

export const SIGN_IN_REJECTED_MESSAGE = `We couldn't verify your sign-in. Refresh the page; if this keeps happening, contact ${LEGAL.contactEmail}.`

export const UNREACHABLE_MESSAGE =
  "Can't reach Catglish right now. Check your connection and try again."

const SUPPORT_HINT = `If this keeps happening, contact ${LEGAL.contactEmail}.`

export const SERVER_ERROR_MESSAGE = `Something went wrong on our end. Refresh the page, or try again in a few minutes. ${SUPPORT_HINT}`

function bodyField(body: unknown, field: 'error' | 'message'): string {
  if (body && typeof body === 'object') {
    const value = (body as Record<string, unknown>)[field]
    if (typeof value === 'string') return value
  }
  return ''
}

// Server messages are written both as "Rephrase service unavailable." and as
// "failed to create checkout session"; a hint appended to the latter needs it
// to read as a sentence.
function asSentence(text: string): string {
  const trimmed = text.trim()
  const capitalized = trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
  return /[.!?]$/.test(capitalized) ? capitalized : `${capitalized}.`
}

// The message for a non-2xx answer whose body has already been read (null when
// it wasn't JSON). Returns null when the status has no rule of its own here.
export function apiErrorMessage(status: number, body: unknown): string | null {
  if (status === 401) {
    // Clerk mints a fresh token on every call, so only enx-api's own
    // "token expired" means the session really ran out.
    return bodyField(body, 'error') === 'token expired'
      ? SESSION_EXPIRED_MESSAGE
      : SIGN_IN_REJECTED_MESSAGE
  }
  if (status >= 500) {
    // Handlers word their own 5xx in `message`; `error` comes from the
    // middleware and is internal.
    const message = bodyField(body, 'message')
    return message
      ? `${asSentence(message)} ${SUPPORT_HINT}`
      : SERVER_ERROR_MESSAGE
  }
  return null
}
