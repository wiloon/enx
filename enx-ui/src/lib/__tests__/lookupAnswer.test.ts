import { classifyLookupAnswer, shownLookupSource } from '../lookupAnswer'
import type { WordData } from '@/types'

const run: WordData = {
  Id: 'w1',
  Key: 'run',
  English: 'run',
  Pronunciation: 'rʌn',
  Chinese: 'v. 跑',
  LoadCount: 3,
  Known: false,
  WordType: 0,
}

describe('classifyLookupAnswer', () => {
  it.each(['local', 'ecdict', 'miss', 'timeout', 'error', undefined, 'later'])(
    'is a result whenever there is a definition (Source %s)',
    (Source) => {
      expect(classifyLookupAnswer({ ...run, Source })).toBe('result')
    }
  )

  it.each(['timeout', 'error'])(
    'is "the dictionary did not answer" without a definition and Source %s',
    (Source) => {
      expect(
        classifyLookupAnswer({ ...run, Chinese: '', Id: '', Source })
      ).toBe('no-answer')
    }
  )

  it.each(['local', 'ecdict', 'miss', undefined, 'later', 'Timeout'])(
    'is a miss without a definition and Source %s',
    (Source) => {
      expect(
        classifyLookupAnswer({ ...run, Chinese: '', Id: '', Source })
      ).toBe('miss')
    }
  )
})

describe('shownLookupSource', () => {
  it.each(['local', 'ecdict'])('shows %s as it is', (source) => {
    expect(shownLookupSource(source)).toBe(source)
  })

  it.each(['miss', 'timeout', 'error', undefined, '', 'Local', 'later'])(
    'shows nothing for %s',
    (source) => {
      expect(shownLookupSource(source)).toBeNull()
    }
  )
})
