import { countLookup } from '@/lib/queryCount'
import { reviewBucket } from '@/lib/wordHighlight'
import type { WordData } from '@/types'

const word = (over: Partial<WordData> = {}): WordData => ({
  Id: 'w-run',
  Key: 'run',
  English: 'run',
  Pronunciation: 'rʌn',
  Chinese: 'v. 跑',
  LoadCount: 2,
  AlreadyAcquainted: 0,
  WordType: 0,
  ...over,
})

describe('countLookup (ADR-059 Decision 3)', () => {
  it('records the lookup once, against the word id the lookup answered with', () => {
    const record = jest.fn()

    countLookup(word({ Id: 'w-run', English: 'run' }), record)

    expect(record).toHaveBeenCalledTimes(1)
    expect(record).toHaveBeenCalledWith('w-run')
  })

  it('shows the word with one more lookup straight away, without waiting for the server', () => {
    const shown = countLookup(word({ LoadCount: 2 }), jest.fn())

    expect(shown.LoadCount).toBe(3)
  })

  it('takes a known word back into review', () => {
    const shown = countLookup(
      word({ LoadCount: 7, AlreadyAcquainted: 1 }),
      jest.fn()
    )

    expect(shown.LoadCount).toBe(8)
    expect(shown.AlreadyAcquainted).toBe(0)
  })

  it('underlines a word on its first lookup, in the first review bucket', () => {
    const neverLookedUp = word({ LoadCount: 0 })
    expect(reviewBucket(neverLookedUp)).toBeNull()

    expect(reviewBucket(countLookup(neverLookedUp, jest.fn()))).toBe(1)
  })

  it('underlines a known word again once it is looked up', () => {
    const known = word({ LoadCount: 2, AlreadyAcquainted: 1 })
    expect(reviewBucket(known)).toBeNull()

    expect(reviewBucket(countLookup(known, jest.fn()))).toBe(2)
  })

  it('records nothing and changes nothing for a word with no id', () => {
    const record = jest.fn()
    const miss = word({ Id: undefined, Chinese: '', LoadCount: 0 })

    const shown = countLookup(miss, record)

    expect(record).not.toHaveBeenCalled()
    expect(shown).toEqual(miss)
  })

  it('leaves the word it was given untouched', () => {
    const original = word({ LoadCount: 2 })

    countLookup(original, jest.fn())

    expect(original.LoadCount).toBe(2)
  })
})
