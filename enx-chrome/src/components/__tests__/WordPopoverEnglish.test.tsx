import { fireEvent, render, screen } from '@testing-library/react'
import { Provider, createStore } from 'jotai'
import WordPopover from '@/components/WordPopover'
import {
  aiLookupAtom,
  aiNoticeAtom,
  currentWordAtom,
  isTranslatingAtom,
  type AiLookupState,
} from '@/store/atoms'
import type { WordData } from '@/types'

jest.mock('@/lib/aiLookup', () => ({
  billingUrl: (src: string) => `https://enx.example.test/billing?src=${src}`,
  stopAutomaticAiLookup: jest.fn(),
  shouldShowAiNotice: jest.fn().mockResolvedValue(false),
}))
jest.mock('@/lib/serverPreferences', () => ({
  fetchPreferences: jest.fn().mockResolvedValue({
    ok: true,
    data: {
      aiWordFallback: { value: null, effective: true, editable: true },
      aiWordFallbackNoticeAck: { value: null, effective: true, editable: true },
    },
  }),
}))
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

function renderPopover(
  current: WordData,
  {
    ai = { status: 'idle' } as AiLookupState,
    notice = { show: false, offerStop: false },
    onAiLookup = jest.fn(),
  } = {}
) {
  const store = createStore()
  store.set(currentWordAtom, current)
  store.set(isTranslatingAtom, false)
  store.set(aiLookupAtom, ai)
  store.set(aiNoticeAtom, notice)
  render(
    <Provider store={store}>
      <WordPopover
        word="left"
        onClose={jest.fn()}
        onMarkKnown={jest.fn()}
        onOpenSentencePanel={jest.fn()}
        onAiLookup={onAiLookup}
      />
    </Provider>
  )
  return { onAiLookup }
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
    'No English definition found.'
  )
  expect(screen.queryByTestId('word-popover-ai-lookup')).toBeNull()
})

it('offers Look up with AI on an English miss when CanUse is true', () => {
  const { onAiLookup } = renderPopover(
    word({
      Id: undefined,
      Senses: undefined,
      LemmaNote: undefined,
      PronunciationUS: undefined,
      PronunciationUK: undefined,
    }),
    { ai: { status: 'offer', canUse: true } }
  )

  expect(screen.getByText('No English definition found.')).toBeInTheDocument()
  fireEvent.click(screen.getByTestId('word-popover-ai-lookup'))
  expect(onAiLookup).toHaveBeenCalled()
})

it('shows the upgrade link on an English miss when CanUse is false', () => {
  renderPopover(
    word({
      Id: undefined,
      Senses: undefined,
      LemmaNote: undefined,
      PronunciationUS: undefined,
      PronunciationUK: undefined,
    }),
    { ai: { status: 'offer', canUse: false } }
  )

  expect(screen.getByText('No English definition found.')).toBeInTheDocument()
  expect(screen.getByTestId('word-popover-ai-upgrade')).toBeInTheDocument()
})

it('shows an AI badge and at most four senses for an English AI result', () => {
  renderPopover(
    word({
      Origin: 'ai',
      LemmaNote: undefined,
      PronunciationUS: undefined,
      PronunciationUK: undefined,
      Senses: [
        { pos: 'noun', gloss: 'Sense one.', example: 'Ex one.' },
        { pos: 'noun', gloss: 'Sense two.' },
        { pos: 'noun', gloss: 'Sense three.' },
        { pos: 'verb', gloss: 'Sense four.' },
        { pos: 'verb', gloss: 'Sense five.' },
        { pos: 'adj', gloss: 'Sense six.' },
      ],
    })
  )

  expect(screen.getByTestId('word-popover-ai-badge')).toBeInTheDocument()
  // Two per part of speech: "Sense three." is the third noun, so the second
  // verb takes its place among the four.
  expect(
    screen.getAllByTestId('word-popover-sense').map(s => s.textContent)
  ).toEqual([
    'noun Sense one.Ex one.',
    'noun Sense two.',
    'verb Sense four.',
    'verb Sense five.',
  ])
})

it('shows the AI notice in English mode', () => {
  renderPopover(word({ Origin: 'ai', Senses: [{ pos: 'noun', gloss: 'A thing.' }] }), {
    notice: { show: true, offerStop: false },
  })

  expect(screen.getByTestId('word-popover-ai-notice')).toBeInTheDocument()
})
