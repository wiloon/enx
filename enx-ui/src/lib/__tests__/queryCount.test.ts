import { countLookup } from '../queryCount'
import type { WordData } from '@/types'

const run: WordData = {
  Id: 'w1',
  Key: 'run',
  English: 'run',
  Pronunciation: 'rʌn',
  Chinese: 'v. 跑',
  LoadCount: 3,
  Known: true,
  WordType: 0,
}

describe('countLookup', () => {
  it('records a word with an id once and returns it one lookup on, back in review', () => {
    const record = jest.fn()

    const counted = countLookup(run, record)

    expect(record).toHaveBeenCalledTimes(1)
    expect(record).toHaveBeenCalledWith('w1')
    expect(counted).toEqual({ ...run, LoadCount: 4, Known: false })
  })

  it('records nothing for a word without an id and returns it unchanged', () => {
    const record = jest.fn()
    const uncached = { ...run, Id: '' }

    const counted = countLookup(uncached, record)

    expect(record).not.toHaveBeenCalled()
    expect(counted).toEqual(uncached)
  })
})
