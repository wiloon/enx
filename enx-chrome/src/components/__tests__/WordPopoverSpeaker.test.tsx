import { act, fireEvent, render, screen } from '@testing-library/react'
import { Provider, createStore } from 'jotai'
import WordPopover from '@/components/WordPopover'
import { lookupWithAi, shouldShowAiNotice } from '@/lib/aiLookup'
import { handleLookupMiss, type AiLookupDeps } from '@/lib/aiLookupFlow'
import { playPronunciation } from '@/lib/pronunciation'
import { currentWordAtom, errorAtom, isTranslatingAtom } from '@/store/atoms'
import type { WordData } from '@/types'

jest.mock('@/lib/aiLookup', () => ({
  billingUrl: (src: string) => `https://enx.example.test/billing?src=${src}`,
  stopAutomaticAiLookup: jest.fn(),
  lookupWithAi: jest.fn(),
  shouldShowAiNotice: jest.fn(),
  acknowledgeAiNotice: jest.fn(),
}))
jest.mock('@/lib/serverPreferences', () => ({ fetchPreferences: jest.fn() }))
jest.mock('@/lib/pronunciation', () => ({ playPronunciation: jest.fn() }))

const play = playPronunciation as jest.Mock
const aiLookup = lookupWithAi as jest.Mock

const SPEAKER = 'word-popover-play-pronunciation'

const word = (overrides: Partial<WordData> = {}): WordData => ({
  Key: 'rizzler',
  English: 'rizzler',
  Pronunciation: '',
  Chinese: '',
  LoadCount: 0,
  Known: false,
  WordType: 0,
  ...overrides,
})

type Setup = {
  current?: WordData | null
  translating?: boolean
  error?: string | null
  variant?: 'dictionary' | 'hint'
  // The clicked word as the page had it, shown as the heading until a
  // result arrives.
  raw?: string
}

function renderPopover({
  current = null,
  translating = false,
  error = null,
  variant = 'dictionary',
  raw = 'Rizzler',
}: Setup = {}) {
  const store = createStore()
  store.set(currentWordAtom, current)
  store.set(isTranslatingAtom, translating)
  store.set(errorAtom, error)
  render(
    <Provider store={store}>
      <WordPopover
        word={raw}
        onClose={jest.fn()}
        onMarkKnown={jest.fn()}
        onOpenSentencePanel={jest.fn()}
        variant={variant}
      />
    </Provider>
  )
  return { store }
}

beforeEach(() => {
  jest.resetAllMocks()
  ;(shouldShowAiNotice as jest.Mock).mockResolvedValue(false)
})

describe('a defined word', () => {
  it('without a phonetic offers the speaker alone, which plays the word', () => {
    renderPopover({ current: word({ Chinese: 'n. 很有魅力的人' }) })

    const header = screen.getByTestId('word-popover-header')
    expect(header).not.toHaveTextContent('/')
    expect(screen.getByTestId(SPEAKER)).toHaveAttribute(
      'aria-label',
      'Play pronunciation'
    )
    fireEvent.click(screen.getByTestId(SPEAKER))

    expect(play).toHaveBeenCalledTimes(1)
    expect(play).toHaveBeenCalledWith('rizzler')
  })

  it('with a phonetic shows it beside the speaker, as before', () => {
    renderPopover({
      current: word({
        English: 'great',
        Chinese: 'adj. 很棒的',
        Pronunciation: 'greɪt',
      }),
      raw: 'Great',
    })

    expect(screen.getByTestId('word-popover-header')).toHaveTextContent(
      '/greɪt/'
    )
    fireEvent.click(screen.getByTestId(SPEAKER))

    expect(play).toHaveBeenCalledTimes(1)
    expect(play).toHaveBeenCalledWith('great')
  })
})

describe('no speaker', () => {
  it('while the lookup is loading, with only the clicked word as heading', () => {
    renderPopover({ translating: true })

    expect(screen.getByRole('heading')).toHaveTextContent('Rizzler')
    expect(screen.queryByTestId(SPEAKER)).toBeNull()
  })

  it('while a lookup is loading over a word that had a definition', () => {
    renderPopover({
      current: word({ Chinese: 'n. 很有魅力的人', Pronunciation: 'rɪzlə' }),
      translating: true,
    })

    expect(screen.queryByTestId(SPEAKER)).toBeNull()
  })

  it('after the lookup failed', () => {
    renderPopover({ error: 'Service temporarily unavailable. Please retry.' })

    expect(screen.getByRole('heading')).toHaveTextContent('Rizzler')
    expect(screen.queryByTestId(SPEAKER)).toBeNull()
  })

  it('after the lookup failed over a word that had a definition', () => {
    renderPopover({
      current: word({ Chinese: 'n. 很有魅力的人', Pronunciation: 'rɪzlə' }),
      error: 'Service temporarily unavailable. Please retry.',
    })

    expect(screen.queryByTestId(SPEAKER)).toBeNull()
  })

  it('for a dictionary miss, even with a phonetic', () => {
    renderPopover({ current: word({ Pronunciation: 'rɪzlə' }) })

    expect(screen.queryByTestId(SPEAKER)).toBeNull()
  })

  it('for a definition whose English word is empty', () => {
    renderPopover({
      current: word({ English: '', Chinese: 'n. 很有魅力的人' }),
    })

    expect(screen.getByRole('heading')).toHaveTextContent('Rizzler')
    expect(screen.queryByTestId(SPEAKER)).toBeNull()
  })

  it('with no current word at all', () => {
    renderPopover()

    expect(screen.queryByTestId(SPEAKER)).toBeNull()
  })

  it('in a hint-only popover', () => {
    renderPopover({
      current: word({ Chinese: 'n. 很有魅力的人' }),
      variant: 'hint',
    })

    expect(screen.queryByTestId(SPEAKER)).toBeNull()
  })
})

describe('a miss handed to the AI fallback', () => {
  const deferred = <T,>() => {
    let resolve!: (value: T) => void
    const promise = new Promise<T>(r => (resolve = r))
    return { promise, resolve }
  }

  function startFallback() {
    const miss = word({ AIFallback: { CanUse: true, Auto: true } })
    const { store } = renderPopover({ current: miss })
    const answer = deferred<unknown>()
    aiLookup.mockReturnValue(answer.promise)
    const deps: AiLookupDeps = {
      store,
      isCurrent: () => true,
      onDefined: jest.fn(),
      onSessionExpired: jest.fn(),
      recordLookup: jest.fn(),
    }
    act(() => handleLookupMiss(miss, deps))
    return answer
  }

  it('offers the speaker only once the AI found a definition, and plays its word', async () => {
    const answer = startFallback()

    expect(screen.getByTestId('word-popover-ai-loading')).toBeInTheDocument()
    expect(screen.queryByTestId(SPEAKER)).toBeNull()

    await act(async () => {
      answer.resolve({
        kind: 'found',
        word: word({ Chinese: 'n. 很有魅力的人', Origin: 'ai' }),
      })
    })

    fireEvent.click(screen.getByTestId(SPEAKER))
    expect(play).toHaveBeenCalledTimes(1)
    expect(play).toHaveBeenCalledWith('rizzler')
  })

  it('offers no speaker when the AI has no definition', async () => {
    const answer = startFallback()

    await act(async () => answer.resolve({ kind: 'none' }))

    expect(screen.getByTestId('word-popover-ai-none')).toBeInTheDocument()
    expect(screen.queryByTestId(SPEAKER)).toBeNull()
  })

  it('offers no speaker when the AI lookup failed', async () => {
    const answer = startFallback()

    await act(async () =>
      answer.resolve({ kind: 'error', reason: 'unavailable' })
    )

    expect(screen.getByTestId('word-popover-ai-error')).toBeInTheDocument()
    expect(screen.queryByTestId(SPEAKER)).toBeNull()
  })
})
