import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Provider, createStore } from 'jotai'
import WordPopover from '@/components/WordPopover'
import { stopAutomaticAiLookup } from '@/lib/aiLookup'
import { fetchPreferences } from '@/lib/serverPreferences'
import {
  aiLookupAtom,
  aiNoticeAtom,
  currentWordAtom,
  type AiLookupState,
} from '@/store/atoms'
import type { WordData } from '@/types'

jest.mock('@/lib/aiLookup', () => ({
  billingUrl: (src: string) => `https://enx.example.test/billing?src=${src}`,
  stopAutomaticAiLookup: jest.fn(),
}))
jest.mock('@/lib/serverPreferences', () => ({ fetchPreferences: jest.fn() }))

const stop = stopAutomaticAiLookup as jest.Mock
const fetchPrefs = fetchPreferences as jest.Mock

const word = (overrides: Partial<WordData> = {}): WordData => ({
  Key: 'rizzler',
  English: 'rizzler',
  Pronunciation: '',
  Chinese: '',
  LoadCount: 0,
  AlreadyAcquainted: 0,
  WordType: 0,
  ...overrides,
})

const view = (effective: boolean) => ({
  value: null,
  effective,
  editable: true,
})
const prefsResult = (autoOn: boolean) => ({
  ok: true,
  data: { aiWordFallback: view(autoOn), aiWordFallbackNoticeAck: view(true) },
})

function renderPopover({
  current = word(),
  ai = { status: 'idle' } as AiLookupState,
  notice = { show: false, offerStop: false },
  onAiLookup = jest.fn(),
} = {}) {
  const store = createStore()
  store.set(currentWordAtom, current)
  store.set(aiLookupAtom, ai)
  store.set(aiNoticeAtom, notice)
  render(
    <Provider store={store}>
      <WordPopover
        word="rizzler"
        onClose={jest.fn()}
        onMarkAcquainted={jest.fn()}
        onOpenSentencePanel={jest.fn()}
        onAiLookup={onAiLookup}
      />
    </Provider>
  )
  return { onAiLookup }
}

beforeEach(() => {
  jest.resetAllMocks()
})

describe('a lookup that found nothing', () => {
  it('says so, with no AI offer, when the server mentions none', () => {
    renderPopover()

    expect(screen.getByTestId('word-popover-not-found')).toHaveTextContent(
      'Not found in the dictionary.'
    )
    expect(screen.queryByTestId('word-popover-ai-lookup')).toBeNull()
    expect(screen.queryByTestId('word-popover-ai-upgrade')).toBeNull()
  })

  it('offers "Look up with AI" to a user who can use it, and runs it on click', () => {
    const { onAiLookup } = renderPopover({
      ai: { status: 'offer', canUse: true },
    })

    fireEvent.click(screen.getByTestId('word-popover-ai-lookup'))

    expect(onAiLookup).toHaveBeenCalledTimes(1)
  })

  it('points a user who cannot use AI at billing, in a new tab, and says why', () => {
    const { onAiLookup } = renderPopover({
      ai: { status: 'offer', canUse: false },
    })

    const link = screen.getByTestId('word-popover-ai-upgrade')
    expect(link).toHaveAttribute(
      'href',
      'https://enx.example.test/billing?src=lookup-miss'
    )
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
    expect(
      screen.getByText('Subscribe or add credit to use AI lookup.')
    ).toBeInTheDocument()
    // It never starts an AI lookup, and the word is not in the link.
    expect(screen.queryByTestId('word-popover-ai-lookup')).toBeNull()
    expect(link.getAttribute('href')).not.toContain('rizzler')
    expect(onAiLookup).not.toHaveBeenCalled()
  })

  it('shows that the AI is working', () => {
    renderPopover({ ai: { status: 'loading' } })

    expect(screen.getByTestId('word-popover-ai-loading')).toHaveTextContent(
      'Not in the dictionary. Asking AI…'
    )
    expect(screen.queryByTestId('word-popover-ai-lookup')).toBeNull()
  })

  it('says when the AI has no definition', () => {
    renderPopover({ ai: { status: 'none' } })

    expect(screen.getByTestId('word-popover-ai-none')).toHaveTextContent(
      "AI couldn't define this word."
    )
  })

  it.each([
    ['credit', 'Not enough credit for an AI lookup.', 'ai-credit'],
    [
      'not-entitled',
      'AI lookup is available with a subscription or a credit balance.',
      'ai-credit',
    ],
  ] as const)(
    'on a %s error, explains and links to billing',
    (reason, message, src) => {
      renderPopover({ ai: { status: 'error', reason } })

      expect(screen.getByTestId('word-popover-ai-error')).toHaveTextContent(
        message
      )
      expect(
        screen.getByRole('link', { name: 'Subscribe / add credit' })
      ).toHaveAttribute('href', `https://enx.example.test/billing?src=${src}`)
    }
  )

  it.each([
    ['rate-limited', 'Too many AI lookups. Try again in a moment.'],
    ['unavailable', "AI lookup isn't available right now."],
  ] as const)(
    'on a %s error, explains and lets the user try again',
    (reason, message) => {
      const { onAiLookup } = renderPopover({ ai: { status: 'error', reason } })

      expect(screen.getByTestId('word-popover-ai-error')).toHaveTextContent(
        message
      )
      fireEvent.click(screen.getByTestId('word-popover-ai-lookup'))
      expect(onAiLookup).toHaveBeenCalledTimes(1)
    }
  )
})

describe('a definition', () => {
  it('has no AI badge when it came from the dictionary', () => {
    renderPopover({ current: word({ Chinese: 'v. 跑', Origin: 'ecdict' }) })

    expect(screen.getByText('v. 跑')).toBeInTheDocument()
    expect(screen.queryByTestId('word-popover-ai-badge')).toBeNull()
    expect(screen.queryByTestId('word-popover-not-found')).toBeNull()
  })

  it('has no AI badge from a server that does not say where it came from', () => {
    renderPopover({ current: word({ Chinese: 'v. 跑' }) })

    expect(screen.queryByTestId('word-popover-ai-badge')).toBeNull()
  })

  it('carries an AI badge when a model wrote it, including from the cache', () => {
    renderPopover({
      current: word({ Chinese: 'n. 很有魅力的人', Origin: 'ai' }),
      ai: { status: 'idle' },
    })

    expect(screen.getByText('n. 很有魅力的人')).toBeInTheDocument()
    expect(screen.getByTestId('word-popover-ai-badge')).toHaveTextContent('AI')
  })
})

describe('the AI badge', () => {
  const aiWord = word({ Chinese: 'n. 很有魅力的人', Origin: 'ai' })

  it('offers to stop automatic AI lookup when it is on, and does so', async () => {
    fetchPrefs.mockResolvedValue(prefsResult(true))
    stop.mockResolvedValue(true)
    renderPopover({ current: aiWord })

    fireEvent.click(screen.getByTestId('word-popover-ai-badge'))
    fireEvent.click(await screen.findByTestId('word-popover-ai-stop'))

    expect(stop).toHaveBeenCalledTimes(1)
    expect(
      await screen.findByText(
        /Automatic AI lookup is off\. You can turn it back on/
      )
    ).toBeInTheDocument()
    expect(screen.queryByTestId('word-popover-ai-stop')).toBeNull()
  })

  it('only says it is off when it already is, with nothing to stop', async () => {
    fetchPrefs.mockResolvedValue(prefsResult(false))
    renderPopover({ current: aiWord })

    fireEvent.click(screen.getByTestId('word-popover-ai-badge'))

    expect(
      await screen.findByText('Automatic AI lookup is off.')
    ).toBeInTheDocument()
    expect(screen.queryByTestId('word-popover-ai-stop')).toBeNull()
  })

  it('says so when the setting cannot be reached', async () => {
    fetchPrefs.mockResolvedValue({
      ok: false,
      reason: 'unavailable',
      error: 'x',
    })
    renderPopover({ current: aiWord })

    fireEvent.click(screen.getByTestId('word-popover-ai-badge'))

    expect(await screen.findByText(/reach your AI setting/)).toBeInTheDocument()
  })

  it('says so, and does not claim success, when stopping fails', async () => {
    fetchPrefs.mockResolvedValue(prefsResult(true))
    stop.mockResolvedValue(false)
    renderPopover({ current: aiWord })

    fireEvent.click(screen.getByTestId('word-popover-ai-badge'))
    fireEvent.click(await screen.findByTestId('word-popover-ai-stop'))

    expect(await screen.findByText(/reach your AI setting/)).toBeInTheDocument()
    expect(
      screen.queryByText(/Automatic AI lookup is off\. You can turn/)
    ).toBeNull()
  })

  it('closes again on a second click, and only asks the server when opening', async () => {
    fetchPrefs.mockResolvedValue(prefsResult(true))
    renderPopover({ current: aiWord })
    const badge = screen.getByTestId('word-popover-ai-badge')

    fireEvent.click(badge)
    await screen.findByTestId('word-popover-ai-menu')
    fireEvent.click(badge)

    await waitFor(() =>
      expect(screen.queryByTestId('word-popover-ai-menu')).toBeNull()
    )
    expect(fetchPrefs).toHaveBeenCalledTimes(1)
  })
})

describe('the one-time notice', () => {
  const aiWord = word({ Chinese: 'n. 很有魅力的人', Origin: 'ai' })

  it('is not there until it is due', () => {
    renderPopover({ current: aiWord })

    expect(screen.queryByTestId('word-popover-ai-notice')).toBeNull()
  })

  it('says only the word was sent', () => {
    renderPopover({ current: aiWord, notice: { show: true, offerStop: false } })

    expect(screen.getByTestId('word-popover-ai-notice')).toHaveTextContent(
      'Only this word was sent to an AI provider, never the sentence or the page.'
    )
    expect(screen.queryByTestId('word-popover-ai-notice-stop')).toBeNull()
  })

  it('offers to stop when the lookup ran by itself, and confirms', async () => {
    stop.mockResolvedValue(true)
    renderPopover({ current: aiWord, notice: { show: true, offerStop: true } })

    fireEvent.click(screen.getByTestId('word-popover-ai-notice-stop'))

    await waitFor(() =>
      expect(screen.queryByTestId('word-popover-ai-notice-stop')).toBeNull()
    )
    expect(screen.getByText('Automatic AI lookup is off.')).toBeInTheDocument()
  })

  it('keeps the offer when stopping did not work', async () => {
    stop.mockResolvedValue(false)
    renderPopover({ current: aiWord, notice: { show: true, offerStop: true } })

    fireEvent.click(screen.getByTestId('word-popover-ai-notice-stop'))

    await waitFor(() => expect(stop).toHaveBeenCalled())
    expect(
      screen.getByTestId('word-popover-ai-notice-stop')
    ).toBeInTheDocument()
  })
})
