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

it('passes English-English fields through', () => {
  expect(
    lookupAnswer('left', [
      {
        Status: 'found',
        Id: 'w-left',
        English: 'left',
        ExplanationLanguage: 'en',
        Source: 'wiktionary',
        Senses: [{ pos: 'n', gloss: 'The west side.', example: 'On the left.' }],
        LemmaNote: 'past tense of leave',
        PronunciationUS: '/lɛft/',
        PronunciationUK: '/left/',
      },
    ])
  ).toEqual({
    kind: 'result',
    word: {
      Id: 'w-left',
      Key: 'left',
      English: 'left',
      Chinese: '',
      Pronunciation: '',
      WordType: 0,
      Source: 'wiktionary',
      ExplanationLanguage: 'en',
      Senses: [{ pos: 'n', gloss: 'The west side.', example: 'On the left.' }],
      LemmaNote: 'past tense of leave',
      PronunciationUS: '/lɛft/',
      PronunciationUK: '/left/',
    },
  })
})
