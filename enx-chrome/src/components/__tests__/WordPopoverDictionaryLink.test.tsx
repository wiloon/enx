import { render, screen } from '@testing-library/react'
import { Provider, createStore } from 'jotai'
import WordPopover from '@/components/WordPopover'
import { shouldShowAiNotice } from '@/lib/aiLookup'
import { currentWordAtom } from '@/store/atoms'
import type { WordData } from '@/types'

jest.mock('@/lib/aiLookup', () => ({
  billingUrl: (src: string) => `https://enx.example.test/billing?src=${src}`,
  stopAutomaticAiLookup: jest.fn(),
  lookupWithAi: jest.fn(),
  shouldShowAiNotice: jest.fn(),
  acknowledgeAiNotice: jest.fn(),
}))
jest.mock('@/lib/serverPreferences', () => ({ fetchPreferences: jest.fn() }))

const word = (overrides: Partial<WordData> = {}): WordData => ({
  Key: 'resilient',
  English: 'resilient',
  Pronunciation: '',
  Chinese: 'adj. 有弹性的',
  LoadCount: 0,
  Known: false,
  WordType: 0,
  ...overrides,
})

function renderPopover(current: WordData | null, raw: string) {
  const store = createStore()
  store.set(currentWordAtom, current)
  render(
    <Provider store={store}>
      <WordPopover
        word={raw}
        onClose={jest.fn()}
        onMarkKnown={jest.fn()}
        onOpenSentencePanel={jest.fn()}
      />
    </Provider>
  )
}

beforeEach(() => {
  jest.resetAllMocks()
  ;(shouldShowAiNotice as jest.Mock).mockResolvedValue(false)
})

describe('the external dictionary link', () => {
  it('is the book icon alone, named for Cambridge, opening the word in a new tab', () => {
    renderPopover(word(), 'Resilient')

    const link = screen.getByRole('link', {
      name: 'Open in Cambridge Dictionary',
    })
    expect(link).toHaveAttribute('title', 'Open in Cambridge Dictionary')
    expect(link).toHaveAttribute(
      'href',
      'https://dictionary.cambridge.org/search/direct/?datasetsearch=english-chinese-simplified&q=resilient'
    )
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(link).toHaveTextContent(/^$/)
  })

  it('falls back to the clicked word before a result arrives', () => {
    renderPopover(null, 'give up')

    expect(
      screen.getByRole('link', { name: 'Open in Cambridge Dictionary' })
    ).toHaveAttribute(
      'href',
      'https://dictionary.cambridge.org/search/direct/?datasetsearch=english-chinese-simplified&q=give%20up'
    )
  })
})
