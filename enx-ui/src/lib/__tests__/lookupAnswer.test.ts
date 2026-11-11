import { lookupAnswer, shownLookupSource } from '../lookupAnswer'

it.each(['w1', undefined])(
  'maps found with Id %s without inventing user state',
  (Id) => {
    expect(
      lookupAnswer('ran', [
        {
          Status: 'found',
          Id,
          English: 'run',
          Chinese: 'v. 跑',
          Source: 'ecdict',
        },
      ])
    ).toEqual({
      kind: 'result',
      word: {
        Id: Id ?? '',
        Key: 'ran',
        English: 'run',
        Chinese: 'v. 跑',
        Pronunciation: '',
        WordType: 0,
        Source: 'ecdict',
      },
    })
  }
)
it.each([
  ['not_found', 'miss'],
  ['failed', 'no-answer'],
])('maps %s to %s', (Status, kind) => {
  expect(lookupAnswer('run', [{ Status }])).toEqual({ kind })
})
it.each(['local', 'ecdict'])('shows admin source %s', (source) =>
  expect(shownLookupSource(source)).toBe(source)
)
it.each(['miss', 'timeout', 'error', undefined, '', 'Local', 'later'])(
  'hides source %s',
  (source) => expect(shownLookupSource(source)).toBeNull()
)
