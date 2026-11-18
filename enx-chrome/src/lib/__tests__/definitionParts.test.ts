import { splitDefinition } from '../definitionParts'

it.each([
  [
    'adj. foo; n. bar',
    [
      { text: 'adj.', partOfSpeech: true },
      { text: ' foo; ', partOfSpeech: false },
      { text: 'n.', partOfSpeech: true },
      { text: ' bar', partOfSpeech: false },
    ],
  ],
  ['plain definition', [{ text: 'plain definition', partOfSpeech: false }]],
  [
    'a note about adj. in prose',
    [{ text: 'a note about adj. in prose', partOfSpeech: false }],
  ],
  [
    'vt. 跑\nvi. 行走',
    [
      { text: 'vt.', partOfSpeech: true },
      { text: ' 跑\n', partOfSpeech: false },
      { text: 'vi.', partOfSpeech: true },
      { text: ' 行走', partOfSpeech: false },
    ],
  ],
  ['', []],
])(
  'preserves definition text and separates POS labels: %s',
  (text, expected) => {
    expect(splitDefinition(text as string)).toEqual(expected)
  }
)
