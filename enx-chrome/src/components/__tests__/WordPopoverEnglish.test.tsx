import { render, screen } from '@testing-library/react'
import { Provider, createStore } from 'jotai'
import WordPopover from '@/components/WordPopover'
import { currentWordAtom, isTranslatingAtom } from '@/store/atoms'
import type { WordData } from '@/types'

jest.mock('@/lib/aiLookup', () => ({
  billingUrl: (src: string) => `https://enx.example.test/billing?src=${src}`,
  stopAutomaticAiLookup: jest.fn(),
  shouldShowAiNotice: jest.fn().mockResolvedValue(false),
}))
jest.mock('@/lib/serverPreferences', () => ({ fetchPreferences: jest.fn() }))
jest.mock('@/components/ExplanationLanguageSwitch', () => ({
  __esModule: true,
  default: () => null,
}))

const word = (overrides: Partial<WordData> = {}): WordData => ({
  Id: 'w-left',
  Key: 'left',
  English: 'left',
  Pronunciation: '',
  Chinese: '',
  WordType: 0,
  ExplanationLanguage: 'en',
  Origin: 'wiktionary',
  LemmaNote: 'past tense of leave',
  PronunciationUS: '/lɛft/',
  PronunciationUK: '/left/',
  Senses: [
    { pos: 'n', gloss: 'The west side.', example: 'On the left.' },
    { pos: 'n', gloss: 'Permission to go.' },
    { pos: 'n', gloss: 'A leftover.' },
    { pos: 'adj', gloss: 'Remaining.' },
    { pos: 'adj', gloss: 'Of the left hand.' },
    { pos: 'adj', gloss: 'Radical.' },
    { pos: 'v', gloss: 'Past of leave.' },
  ],
  ...overrides,
})

function renderPopover(current: WordData) {
  const store = createStore()
  store.set(currentWordAtom, current)
  store.set(isTranslatingAtom, false)
  render(
    <Provider store={store}>
      <WordPopover
        word="left"
        onClose={jest.fn()}
        onMarkKnown={jest.fn()}
        onOpenSentencePanel={jest.fn()}
      />
    </Provider>
  )
}

it('shows the lemma note, one US pronunciation, and at most four senses', () => {
  renderPopover(word())

  expect(screen.getByTestId('word-popover-lemma-note')).toHaveTextContent(
    'past tense of leave'
  )
  expect(screen.getByTestId('word-popover-header')).toHaveTextContent('/lɛft/')
  const senses = screen.getAllByTestId('word-popover-sense')
  expect(senses).toHaveLength(4)
  expect(senses[0]).toHaveTextContent('n The west side.')
  expect(senses[0]).toHaveTextContent('On the left.')
  expect(senses.map(s => s.textContent)).toEqual([
    'n The west side.On the left.',
    'n Permission to go.',
    'adj Remaining.',
    'adj Of the left hand.',
  ])
})

it('falls back to UK IPA when there is no US one', () => {
  renderPopover(word({ PronunciationUS: undefined, PronunciationUK: '/left/' }))

  expect(screen.getByTestId('word-popover-header')).toHaveTextContent('/left/')
})

it('shows an English miss with no AI offer', () => {
  renderPopover(
    word({
      Id: undefined,
      Senses: undefined,
      LemmaNote: undefined,
      PronunciationUS: undefined,
      PronunciationUK: undefined,
    })
  )

  expect(screen.getByTestId('word-popover-en-miss')).toHaveTextContent(
    'No definition found.'
  )
  expect(screen.queryByTestId('word-popover-ai-offer')).toBeNull()
})
