import {
  LookupFailure,
  canRetryLookup,
  classifyLookupAnswer,
  shownLookupSource,
} from '../lookupAnswer'
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

describe('canRetryLookup', () => {
  it.each([502, 503])('offers Retry for HTTP %s', (status) => {
    expect(canRetryLookup(new LookupFailure('Down', { status }))).toBe(true)
  })

  it('offers Retry for a network failure', () => {
    expect(
      canRetryLookup(new LookupFailure('Unreachable', { networkFailure: true }))
    ).toBe(true)
  })

  it.each([400, 401, 402, 404, 429, 500, 504])(
    'offers no Retry for HTTP %s',
    (status) => {
      expect(canRetryLookup(new LookupFailure('No', { status }))).toBe(false)
    }
  )

  it('offers no Retry for a failure with no status that is not a network failure', () => {
    expect(canRetryLookup(new LookupFailure('Account disabled', {}))).toBe(
      false
    )
  })

  it('offers no Retry for any other error', () => {
    expect(canRetryLookup(new Error('boom'))).toBe(false)
  })
})
