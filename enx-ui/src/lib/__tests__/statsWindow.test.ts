import {
  approximateWords,
  bucketLabels,
  fromLocalISODate,
  lookupDensity,
  seriesWindow,
  toLocalISODate,
} from '../statsWindow'
import type { StatsPoint } from '@/types'

function point(wordsRead: number, wordLookups: number): StatsPoint {
  return {
    date: '2026-09-16',
    totals: {
      wordsRead,
      articlesRead: 0,
      wordLookups,
      newWords: 0,
      wordsMastered: 0,
      phraseLookups: 0,
      sentenceTranslations: 0,
      contextLookups: 0,
    },
  }
}

describe('toLocalISODate', () => {
  it('uses the local day, which toISOString() would get wrong', () => {
    // 07:00 on Jan 1 in UTC+8 is still Dec 31 in UTC.
    const morning = new Date(2026, 0, 1, 7, 0)
    expect(toLocalISODate(morning)).toBe('2026-01-01')
  })

  it('round-trips through fromLocalISODate', () => {
    expect(toLocalISODate(fromLocalISODate('2026-09-16'))).toBe('2026-09-16')
  })
})

describe('seriesWindow', () => {
  const wednesday = new Date(2026, 8, 16) // 2026-09-16

  it('asks for 30 days including today', () => {
    expect(seriesWindow('day', wednesday)).toEqual({
      from: '2026-08-18',
      to: '2026-09-16',
    })
  })

  it('snaps the weekly window back to a Monday', () => {
    const { from } = seriesWindow('week', wednesday)
    expect(fromLocalISODate(from).getDay()).toBe(1)
  })

  it('starts the monthly window on the first of the month', () => {
    expect(seriesWindow('month', wednesday).from).toBe('2025-10-01')
  })

  it('starts the yearly window on January 1st', () => {
    expect(seriesWindow('year', wednesday).from).toBe('2022-01-01')
  })
})

describe('bucketLabels', () => {
  it('names a month bucket by month and year, not by its first day', () => {
    expect(bucketLabels('month', '2026-09-01').fullLabel).toBe('Sep 2026')
  })

  it('says "week of" so a Monday is not read as a single day', () => {
    expect(bucketLabels('week', '2026-09-14').fullLabel).toMatch(/^Week of /)
  })

  it('labels a year bucket with the year alone', () => {
    expect(bucketLabels('year', '2026-01-01')).toEqual({
      label: '2026',
      fullLabel: '2026',
    })
  })
})

describe('lookupDensity', () => {
  it('is lookups per thousand words', () => {
    expect(lookupDensity(point(2000, 30), 'day')).toBe(15)
  })

  it('refuses to answer for a bucket too thin to mean anything', () => {
    // 3 lookups in 40 words would plot as 75/1,000 -- a spike that reads as
    // a collapse in vocabulary on a day the user barely read.
    expect(lookupDensity(point(40, 3), 'day')).toBeNull()
  })

  it('holds a longer bucket to a higher bar than a single day', () => {
    expect(lookupDensity(point(300, 6), 'day')).toBe(20)
    expect(lookupDensity(point(300, 6), 'week')).toBeNull()
  })
})

describe('approximateWords', () => {
  it('rounds to the nearest hundred below ten thousand', () => {
    expect(approximateWords(1237)).toBe('1,200')
  })

  it('rounds to the nearest thousand above it', () => {
    expect(approximateWords(84_321)).toBe('84,000')
  })

  it('refuses to imply precision for a handful of words', () => {
    expect(approximateWords(37)).toBe('<100')
  })

  it('shows a real zero as zero, not as "<100"', () => {
    expect(approximateWords(0)).toBe('0')
  })
})
