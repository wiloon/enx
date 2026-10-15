// How the Word List shows when a word was looked up. Calendar days in the
// viewer's own time zone: a word looked up at 23:00 yesterday is
// "yesterday", not "today", even though it is under 24 hours old.

const DAY_MS = 24 * 60 * 60 * 1000

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

// "today", "yesterday", "3 days ago", then the date itself from a week back.
export function lastLookedUpLabel(iso: string, now: Date): string {
  const then = new Date(iso)
  const days = Math.round((startOfDay(now) - startOfDay(then)) / DAY_MS)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  return then.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(then.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  })
}

// The hover text on that label: both ends of the word's lookup history.
export function lookupTimesTitle(firstIso: string, lastIso: string): string {
  const last = new Date(lastIso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
  const first = new Date(firstIso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
  return `Last looked up ${last}\nFirst looked up ${first}`
}
