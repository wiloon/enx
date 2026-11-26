import type { AdminFunnelCohort } from '@/types'

// The funnel's steps in order, each with its definition for the legend.
// enx-api's funnel package is the source of truth for what is counted.
export const FUNNEL_STEPS: {
  key: Exclude<keyof AdminFunnelCohort, 'weekStart'>
  label: string
  definition: string
}[] = [
  {
    key: 'signedUp',
    label: 'Signed up',
    definition:
      'Accounts created in the week, Monday 00:00 UTC to the next Monday.',
  },
  {
    key: 'firstLookup',
    label: 'First lookup',
    definition: 'Looked up a word on at least one day, so far.',
  },
  {
    key: 'threeLookupDays',
    label: '3 lookup days',
    definition:
      'Looked up words on 3 or more days, up to 13 days after sign-up.',
  },
  {
    key: 'week2',
    label: 'Week 2',
    definition: 'Looked up a word 7 to 13 days after sign-up.',
  },
  {
    key: 'week4',
    label: 'Week 4',
    definition: 'Looked up a word 21 to 27 days after sign-up.',
  },
  {
    key: 'firstAiCall',
    label: 'First AI call',
    definition: 'Spent credits on at least one AI call, so far.',
  },
  {
    key: 'trialEnded',
    label: 'Trial ended',
    definition: 'Their trial credits are used up or expired, so far.',
  },
  {
    key: 'firstPayment',
    label: 'First payment',
    definition: 'Paid for a subscription or a top-up at least once, so far.',
  },
]

// A step's count as a whole percent of the week's sign-ups, or null when there
// is nothing to show: the step is not measurable yet, or nobody signed up.
export function shareOfSignUps(
  count: number | null,
  signedUp: number
): string | null {
  if (count === null || signedUp === 0) return null
  return `${Math.round((count / signedUp) * 100)}%`
}
