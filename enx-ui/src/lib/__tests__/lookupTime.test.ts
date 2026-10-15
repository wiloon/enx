import { lastLookedUpLabel, lookupTimesTitle } from '../lookupTime'

// Local-time constructors, so the calendar days below are the same in any
// time zone the suite runs in.
const now = new Date(2026, 9, 15, 10, 0)
const at = (month: number, day: number, hour = 9, year = 2026) =>
  new Date(year, month - 1, day, hour, 30).toISOString()

describe('lastLookedUpLabel', () => {
  it('counts calendar days, not 24-hour spans', () => {
    expect(lastLookedUpLabel(at(10, 15, 0), now)).toBe('today')
    expect(lastLookedUpLabel(at(10, 14, 23), now)).toBe('yesterday')
    expect(lastLookedUpLabel(at(10, 12), now)).toBe('3 days ago')
    expect(lastLookedUpLabel(at(10, 9), now)).toBe('6 days ago')
  })

  it('names the date once it is a week or more back', () => {
    expect(lastLookedUpLabel(at(10, 8), now)).toBe('Oct 8')
    expect(lastLookedUpLabel(at(12, 30, 9, 2025), now)).toBe('Dec 30, 2025')
  })
})

describe('lookupTimesTitle', () => {
  it('spells out the last and the first lookup', () => {
    expect(lookupTimesTitle(at(10, 1, 14), at(10, 15, 14))).toBe(
      'Last looked up Oct 15, 2026, 2:30 PM\nFirst looked up Oct 1, 2026'
    )
  })
})
