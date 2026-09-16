import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Avoid loading the real sentry.ts (uses `import.meta`, which ts-jest can't
// parse under CommonJS) -- same reasoning as background.test.ts's env.ts mock.
jest.mock('@/lib/sentry', () => ({
  initSentry: jest.fn(),
}))

// SidePanel now links to enx-ui's billing page (config.frontendBaseUrl) from
// its 402/429 error UI -- same import.meta issue as the sentry mock above.
jest.mock('@/config/env', () => ({
  config: {
    frontendBaseUrl: 'http://localhost:3000',
  },
}))

jest.mock('@/services/api', () => ({
  sendMessageToBackground: jest.fn(),
}))

import { sendMessageToBackground } from '@/services/api'
import { BackgroundResponse, LATEST_PAGE_WORD_STORAGE_KEY, PENDING_SENTENCE_STORAGE_KEY } from '@/types'
import SidePanel from '../SidePanel'

const mockSendMessage = sendMessageToBackground as jest.Mock

const SENTENCE = 'Cats are great pets.'

// The rendered original sentence is plain selectable text (ADR-017), so a
// "word click" is a selection resolved by character offset, not a button
// press. This drives the same path the browser would when the user
// clicks/drags over `word`: set the DOM selection to span `word` within the
// sentence element (walking text nodes so it works even when a <mark>
// highlight splits them) and fire the mouseup the handler listens for.
// `container` picks which sentence's <p> to select in when more than one
// SentenceEntry (ADR-023) is on screen at once; defaults to the sole one.
const selectWord = (word: string, sentence = SENTENCE, container?: HTMLElement) => {
  const el = container ?? screen.getByTestId('sidepanel-sentence')
  const start = sentence.toLowerCase().indexOf(word.toLowerCase())
  const end = start + word.length
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let acc = 0
  let startNode: Node | null = null
  let startOffset = 0
  let endNode: Node | null = null
  let endOffset = 0
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const len = n.textContent!.length
    if (startNode === null && start <= acc + len) {
      startNode = n
      startOffset = start - acc
    }
    if (endNode === null && end <= acc + len) {
      endNode = n
      endOffset = end - acc
    }
    acc += len
  }
  const range = document.createRange()
  range.setStart(startNode!, startOffset)
  range.setEnd(endNode!, endOffset)
  const sel = window.getSelection()!
  sel.removeAllRanges()
  sel.addRange(range)
  fireEvent.mouseUp(el)
}

type StorageChangeListener = (
  changes: { [key: string]: chrome.storage.StorageChange },
  areaName: string
) => void

describe('SidePanel', () => {
  // SidePanel registers one onChanged listener per storage key it watches
  // (PENDING_SENTENCE_STORAGE_KEY and LATEST_PAGE_WORD_STORAGE_KEY, see
  // ADR-006), so tests must fan a simulated storage event out to all of
  // them -- each listener already ignores keys/areas it doesn't care about.
  let storageChangeListeners: StorageChangeListener[]
  const fireStorageChange: StorageChangeListener = (changes, areaName) => {
    storageChangeListeners.forEach(listener => listener(changes, areaName))
  }

  beforeEach(() => {
    jest.clearAllMocks()
    storageChangeListeners = []
    ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({})
    ;(chrome.storage.onChanged.addListener as jest.Mock).mockImplementation(
      (listener: StorageChangeListener) => {
        storageChangeListeners.push(listener)
      }
    )
    ;(chrome.storage.onChanged.removeListener as jest.Mock).mockImplementation(() => {})
  })

  it('shows the empty state when there is no pending sentence context (spec §4.1)', async () => {
    render(<SidePanel />)
    expect(await screen.findByTestId('sidepanel-empty-state')).toBeInTheDocument()
  })

  it('loads and displays the sentence + translation once a pending context is stored', async () => {
    ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({
      [PENDING_SENTENCE_STORAGE_KEY]: {
        sentence: 'Cats are great pets.',
        word: '',
        sourceUrl: 'https://example.com',
        createdAt: 1,
      },
    })
    mockSendMessage.mockResolvedValue({ success: true, chinese: '猫是很棒的宠物。' })

    render(<SidePanel />)

    expect(await screen.findByTestId('sidepanel-sentence')).toHaveTextContent(
      'Cats are great pets.'
    )
    await waitFor(() =>
      expect(screen.getByTestId('sidepanel-chinese')).toHaveTextContent('猫是很棒的宠物。')
    )
  })

  it('renders the original sentence as selectable plain text, not per-word buttons (ADR-017)', async () => {
    ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({
      [PENDING_SENTENCE_STORAGE_KEY]: {
        sentence: 'Cats are great pets.',
        word: '',
        sourceUrl: '',
        createdAt: 1,
      },
    })
    mockSendMessage.mockResolvedValue({ success: true, chinese: '猫是很棒的宠物。' })

    render(<SidePanel />)

    const sentence = await screen.findByTestId('sidepanel-sentence')
    expect(sentence).toHaveTextContent('Cats are great pets.')
    expect(within(sentence).queryAllByRole('button')).toHaveLength(0)
  })

  it('shows the translator error message instead of a blank/silent result (spec §4.4/§4.6 tie-in)', async () => {
    ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({
      [PENDING_SENTENCE_STORAGE_KEY]: {
        sentence: 'Cats are great pets.',
        word: '',
        sourceUrl: '',
        createdAt: 1,
      },
    })
    mockSendMessage.mockResolvedValue({
      success: false,
      error: 'translation service unavailable',
    })

    render(<SidePanel />)

    expect(await screen.findByTestId('sidepanel-error')).toHaveTextContent(
      'translation service unavailable'
    )
  })

  it('shows an upgrade link instead of the raw message when sentence translation fails with 402 (insufficient AI credit)', async () => {
    ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({
      [PENDING_SENTENCE_STORAGE_KEY]: {
        sentence: 'Cats are great pets.',
        word: '',
        sourceUrl: '',
        createdAt: 1,
      },
    })
    mockSendMessage.mockResolvedValue({
      success: false,
      error: 'Insufficient credit. Please add credit or subscribe.',
      status: 402,
    })

    render(<SidePanel />)

    const errorBox = await screen.findByTestId('sidepanel-error')
    expect(errorBox).toHaveTextContent('Not enough AI translation credit')
    const link = within(errorBox).getByText('Subscribe / add credit')
    expect(link).toHaveAttribute('href', 'http://localhost:3000/billing')
  })

  it('shows an upgrade link on a word-context translation 402, alongside the retry button', async () => {
    ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({
      [PENDING_SENTENCE_STORAGE_KEY]: {
        sentence: 'Cats are great pets.',
        word: '',
        sourceUrl: '',
        createdAt: 1,
      },
    })
    mockSendMessage.mockImplementation(async (message: { type: string; word?: string }) => {
      if (message.type === 'translateSentence') {
        return { success: true, chinese: '猫是很棒的宠物。' }
      }
      if (message.type === 'translateWordInContext') {
        return { success: false, error: 'Insufficient credit. Please add credit or subscribe.', status: 402 }
      }
      if (message.type === 'getOneWord') {
        return {
          success: true,
          ecp: { English: message.word, Chinese: 'unused', Pronunciation: '/greɪt/' },
        }
      }
      return { success: false }
    })

    render(<SidePanel />)
    await screen.findByTestId('sidepanel-sentence')
    selectWord('great')

    const errorRow = await screen.findByTestId('sidepanel-context-error-great')
    expect(errorRow).toHaveTextContent('Not enough AI translation credit')
    expect(within(errorRow).getByText('Subscribe / add credit')).toHaveAttribute(
      'href',
      'http://localhost:3000/billing'
    )
    // Retry must still be there -- topping up in another tab and retrying
    // here should work without reopening the panel.
    expect(within(errorRow).getByTestId('sidepanel-retry-context-great')).toBeInTheDocument()
  })

  it('shows an upgrade link (not the raw error) when the dictionary lookup hits the daily quota (429)', async () => {
    ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({
      [PENDING_SENTENCE_STORAGE_KEY]: {
        sentence: 'Cats are great pets.',
        word: '',
        sourceUrl: '',
        createdAt: 1,
      },
    })
    mockSendMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type === 'translateSentence') {
        return { success: true, chinese: '猫是很棒的宠物。' }
      }
      if (message.type === 'translateWordInContext') {
        return { success: true, chinese: '很棒的' }
      }
      if (message.type === 'getOneWord') {
        return {
          success: false,
          error: 'Daily dictionary lookup limit reached. Upgrade to enx Pro for unlimited lookups.',
          status: 429,
        }
      }
      return { success: false }
    })

    render(<SidePanel />)
    await screen.findByTestId('sidepanel-sentence')
    selectWord('great')

    const errorRow = await screen.findByTestId('sidepanel-dictionary-error-great')
    expect(errorRow).toHaveTextContent("You've used up today's free lookups")
    expect(errorRow).not.toHaveTextContent('Upgrade to enx Pro')
    expect(within(errorRow).getByText('Subscribe / add credit')).toHaveAttribute(
      'href',
      'http://localhost:3000/billing'
    )
  })

  it('appends word cards on click instead of replacing the previous one, newest on top (spec §3.9/§4.5)', async () => {
    ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({
      [PENDING_SENTENCE_STORAGE_KEY]: {
        sentence: 'Cats are great pets.',
        word: '',
        sourceUrl: '',
        createdAt: 1,
      },
    })
    mockSendMessage.mockImplementation(async (message: { type: string; word?: string }) => {
      if (message.type === 'translateSentence') {
        return { success: true, chinese: '猫是很棒的宠物。' }
      }
      if (message.type === 'translateWordInContext') {
        return { success: true, chinese: `${message.word}在这句里的意思` }
      }
      if (message.type === 'getOneWord') {
        return {
          success: true,
          ecp: {
            English: message.word,
            Chinese: `${message.word}的通用词典释义`,
            Pronunciation: `/${message.word}/`,
            LoadCount: 3,
          },
        }
      }
      return { success: false }
    })

    render(<SidePanel />)
    await screen.findByTestId('sidepanel-sentence')

    selectWord('Cats')
    selectWord('great')

    await waitFor(() => {
      // Selected inside the sentence, so both cards nest under it (ADR-023),
      // not a separate top-level list.
      const definitions = screen.getByTestId('sidepanel-sentence-words')
      expect(definitions).toHaveTextContent('cats在这句里的意思')
      expect(definitions).toHaveTextContent('great在这句里的意思')
      expect(definitions).toHaveTextContent('/cats/')
      expect(definitions).toHaveTextContent('/great/')
      // Dictionary Chinese meaning is shown now (spec §3.9), unlike the
      // §3.7 2026-08-03 version which discarded it.
      expect(definitions).toHaveTextContent('cats的通用词典释义')
      expect(definitions).toHaveTextContent('great的通用词典释义')
      // Query Count is now shown as a magnifying-glass icon + number, with
      // "Query Count: N" as the hover title rather than visible text.
      expect(within(screen.getByTestId('sidepanel-card-cats')).getByTitle('Query Count: 3')).toBeInTheDocument()
      expect(within(screen.getByTestId('sidepanel-card-great')).getByTitle('Query Count: 3')).toBeInTheDocument()
    })

    // Newest click ('great') renders above the earlier one ('cats').
    const cards = screen.getAllByTestId(/^sidepanel-card-/)
    expect(cards.map(c => c.getAttribute('data-testid'))).toEqual([
      'sidepanel-card-great',
      'sidepanel-card-cats',
    ])
  })

  it('still shows dictionary info when the contextual translation fails, and vice versa (spec §4.5, 互不阻塞)', async () => {
    ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({
      [PENDING_SENTENCE_STORAGE_KEY]: {
        sentence: 'Cats are great pets.',
        word: '',
        sourceUrl: '',
        createdAt: 1,
      },
    })
    mockSendMessage.mockImplementation(async (message: { type: string; word?: string }) => {
      if (message.type === 'translateSentence') {
        return { success: true, chinese: '猫是很棒的宠物。' }
      }
      if (message.type === 'translateWordInContext') {
        return { success: false, error: 'translation service unavailable' }
      }
      if (message.type === 'getOneWord') {
        return {
          success: true,
          ecp: { English: message.word, Chinese: 'unused', Pronunciation: '/greɪt/' },
        }
      }
      return { success: false }
    })

    render(<SidePanel />)
    await screen.findByTestId('sidepanel-sentence')

    selectWord('great')

    await waitFor(() => {
      const definitions = screen.getByTestId('sidepanel-sentence-words')
      expect(definitions).toHaveTextContent('translation service unavailable')
      expect(definitions).toHaveTextContent('/greɪt/')
      expect(definitions).toHaveTextContent('unused')
    })
  })

  it('renders a phrase card instead of the top sentence-translation slot when pendingContext.phrase is set (ADR-008)', async () => {
    const fullSentence =
      "I'd have to find the right contacts, hunt down emails, and draft outreach."
    ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({
      [PENDING_SENTENCE_STORAGE_KEY]: {
        sentence: fullSentence,
        word: '',
        phrase: 'hunt down emails',
        sourceUrl: '',
        createdAt: 1,
      },
    })
    mockSendMessage.mockImplementation(
      async (message: { type: string; word?: string; sentence?: string }) => {
        if (message.type === 'translateWordInContext') {
          expect(message.word).toBe('hunt down emails')
          expect(message.sentence).toBe(fullSentence)
          return { success: true, chinese: '找到邮箱地址并联系' }
        }
        return { success: false }
      }
    )

    render(<SidePanel />)

    const card = await screen.findByTestId('sidepanel-card-hunt down emails')
    expect(card).toHaveTextContent('找到邮箱地址并联系')

    // The top single-slot sentence-translation area must stay untouched --
    // a phrase context is not a whole-sentence translation.
    expect(screen.queryByTestId('sidepanel-chinese')).not.toBeInTheDocument()
    expect(screen.queryByTestId('sidepanel-loading')).not.toBeInTheDocument()
    expect(screen.queryByTestId('sidepanel-error')).not.toBeInTheDocument()
    expect(mockSendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'translateSentence' })
    )

    // No dictionary data exists for a phrase -- no pronunciation, no query
    // count, no dictionary-meaning block should render on this card.
    expect(within(card).queryByText(/Loading phonetics/)).not.toBeInTheDocument()
    expect(within(card).queryByText(/Loading dictionary definition/)).not.toBeInTheDocument()
  })

  it('shows an error + retry on a phrase card, same as a word card (ADR-008)', async () => {
    const fullSentence = 'Your session has just expired mid-sentence for this phrase test.'
    ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({
      [PENDING_SENTENCE_STORAGE_KEY]: {
        sentence: fullSentence,
        word: '',
        phrase: 'expired mid-sentence',
        sourceUrl: '',
        createdAt: 1,
      },
    })
    let callCount = 0
    mockSendMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type === 'translateWordInContext') {
        callCount += 1
        if (callCount === 1) {
          return { success: false, error: 'Your session has expired. Please login again.' }
        }
        return { success: true, chinese: '句子中途过期' }
      }
      return { success: false }
    })

    const user = userEvent.setup()
    render(<SidePanel />)

    const errorRow = await screen.findByTestId('sidepanel-context-error-expired mid-sentence')
    expect(errorRow).toHaveTextContent('Your session has expired. Please login again.')

    await user.click(within(errorRow).getByTestId('sidepanel-retry-context-expired mid-sentence'))

    await waitFor(() => {
      expect(screen.queryByTestId('sidepanel-context-error-expired mid-sentence')).not.toBeInTheDocument()
      expect(screen.getByTestId('sidepanel-card-expired mid-sentence')).toHaveTextContent('句子中途过期')
    })
    expect(callCount).toBe(2)
  })

  it('lets the user retry a failed contextual translation (e.g. session expiry) instead of leaving the card stuck', async () => {
    ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({
      [PENDING_SENTENCE_STORAGE_KEY]: {
        sentence: 'Cats are great pets.',
        word: '',
        sourceUrl: '',
        createdAt: 1,
      },
    })
    let contextCallCount = 0
    mockSendMessage.mockImplementation(async (message: { type: string; word?: string }) => {
      if (message.type === 'translateSentence') {
        return { success: true, chinese: '猫是很棒的宠物。' }
      }
      if (message.type === 'translateWordInContext') {
        contextCallCount += 1
        if (contextCallCount === 1) {
          return { success: false, error: 'Your session has expired. Please login again.' }
        }
        return { success: true, chinese: '很棒的' }
      }
      if (message.type === 'getOneWord') {
        return {
          success: true,
          ecp: { English: message.word, Chinese: 'unused', Pronunciation: '/greɪt/' },
        }
      }
      return { success: false }
    })

    const user = userEvent.setup()
    render(<SidePanel />)
    await screen.findByTestId('sidepanel-sentence')

    selectWord('great')

    const errorRow = await screen.findByTestId('sidepanel-context-error-great')
    expect(errorRow).toHaveTextContent('Your session has expired. Please login again.')

    await user.click(within(errorRow).getByTestId('sidepanel-retry-context-great'))

    await waitFor(() => {
      expect(screen.queryByTestId('sidepanel-context-error-great')).not.toBeInTheDocument()
      expect(screen.getByTestId('sidepanel-sentence-words')).toHaveTextContent('很棒的')
    })
    expect(contextCallCount).toBe(2)
  })

  it('renders the card progressively: dictionary info appears before the slower AI context translation resolves (spec §3.9)', async () => {
    ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({
      [PENDING_SENTENCE_STORAGE_KEY]: {
        sentence: 'Cats are great pets.',
        word: '',
        sourceUrl: '',
        createdAt: 1,
      },
    })

    let resolveContext: (value: BackgroundResponse) => void = () => {}
    mockSendMessage.mockImplementation((message: { type: string; word?: string }) => {
      if (message.type === 'translateSentence') {
        return Promise.resolve({ success: true, chinese: '猫是很棒的宠物。' })
      }
      if (message.type === 'translateWordInContext') {
        return new Promise(resolve => {
          resolveContext = resolve
        })
      }
      if (message.type === 'getOneWord') {
        return Promise.resolve({
          success: true,
          ecp: { English: message.word, Chinese: '很棒的', Pronunciation: '/greɪt/', LoadCount: 1 },
        })
      }
      return Promise.resolve({ success: false })
    })

    render(<SidePanel />)
    await screen.findByTestId('sidepanel-sentence')

    selectWord('great')

    await waitFor(() => {
      const card = screen.getByTestId('sidepanel-card-great')
      expect(card).toHaveTextContent('/greɪt/')
      expect(card).toHaveTextContent('很棒的')
      expect(card).toHaveTextContent('Translating...')
    })

    resolveContext({ success: true, chinese: 'great在这句里的意思' })

    await waitFor(() => {
      const card = screen.getByTestId('sidepanel-card-great')
      expect(card).toHaveTextContent('great在这句里的意思')
      expect(card).not.toHaveTextContent('Translating...')
    })
  })

  it('re-clicking a word already in the list moves its card to the top instead of re-fetching (spec §3.9)', async () => {
    ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({
      [PENDING_SENTENCE_STORAGE_KEY]: {
        sentence: 'Cats are great pets.',
        word: '',
        sourceUrl: '',
        createdAt: 1,
      },
    })
    mockSendMessage.mockImplementation(async (message: { type: string; word?: string }) => {
      if (message.type === 'translateSentence') {
        return { success: true, chinese: '猫是很棒的宠物。' }
      }
      if (message.type === 'translateWordInContext') {
        return { success: true, chinese: `${message.word}在这句里的意思` }
      }
      if (message.type === 'getOneWord') {
        return {
          success: true,
          ecp: { English: message.word, Chinese: `${message.word}释义`, Pronunciation: `/${message.word}/` },
        }
      }
      return { success: false }
    })

    render(<SidePanel />)
    await screen.findByTestId('sidepanel-sentence')

    selectWord('Cats')
    selectWord('great')
    await waitFor(() => expect(screen.getByTestId('sidepanel-card-cats')).toHaveTextContent('cats释义'))

    const callsAfterTwoDistinctWords = mockSendMessage.mock.calls.length
    selectWord('Cats')

    // Re-click just reorders -- no new getOneWord/translateWordInContext calls.
    await waitFor(() => {
      const cards = screen.getAllByTestId(/^sidepanel-card-/)
      expect(cards.map(c => c.getAttribute('data-testid'))).toEqual([
        'sidepanel-card-cats',
        'sidepanel-card-great',
      ])
    })
    expect(mockSendMessage.mock.calls.length).toBe(callsAfterTwoDistinctWords)
  })

  it('does not render a dictionary section, or the literal string "undefined", when the dictionary lookup has no Chinese meaning (spec §3.9)', async () => {
    ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({
      [PENDING_SENTENCE_STORAGE_KEY]: {
        sentence: 'Cats are great pets.',
        word: '',
        sourceUrl: '',
        createdAt: 1,
      },
    })
    mockSendMessage.mockImplementation(async (message: { type: string; word?: string }) => {
      if (message.type === 'translateSentence') {
        return { success: true, chinese: '猫是很棒的宠物。' }
      }
      if (message.type === 'translateWordInContext') {
        return { success: true, chinese: `${message.word}在这句里的意思` }
      }
      if (message.type === 'getOneWord') {
        return { success: true, ecp: { English: message.word, Chinese: '', Pronunciation: '' } }
      }
      return { success: false }
    })

    render(<SidePanel />)
    await screen.findByTestId('sidepanel-sentence')

    selectWord('great')

    await waitFor(() => {
      const card = screen.getByTestId('sidepanel-card-great')
      expect(card).toHaveTextContent('great在这句里的意思')
    })
    const card = screen.getByTestId('sidepanel-card-great')
    expect(card).not.toHaveTextContent('undefined')
  })

  it('refreshes in place with a new sentence when storage.onChanged fires, without needing sidePanel.open() again (spec §4.6)', async () => {
    mockSendMessage.mockImplementation(async (message: { sentence?: string }) => {
      if (message.sentence === 'First sentence.') {
        return { success: true, chinese: '第一句。' }
      }
      if (message.sentence === 'Second sentence.') {
        return { success: true, chinese: '第二句。' }
      }
      return { success: false }
    })

    render(<SidePanel />)
    await screen.findByTestId('sidepanel-empty-state')

    act(() => {
      fireStorageChange(
        {
          [PENDING_SENTENCE_STORAGE_KEY]: {
            newValue: {
              sentence: 'First sentence.',
              word: '',
              sourceUrl: '',
              createdAt: 1,
            },
          },
        },
        'session'
      )
    })
    await waitFor(() =>
      expect(screen.getByTestId('sidepanel-chinese')).toHaveTextContent('第一句。')
    )

    act(() => {
      fireStorageChange(
        {
          [PENDING_SENTENCE_STORAGE_KEY]: {
            newValue: {
              sentence: 'Second sentence.',
              word: '',
              sourceUrl: '',
              createdAt: 2,
            },
          },
        },
        'session'
      )
    })
    // Refreshes in place (no sidePanel.open() needed) and, since ADR-023,
    // prepends rather than replaces -- the first sentence stays as history.
    await waitFor(() => {
      const chineses = screen.getAllByTestId('sidepanel-chinese')
      expect(chineses.map(c => c.textContent)).toEqual(['第二句。', '第一句。'])
    })
  })

  it('ignores storage.onChanged events from areas other than session', async () => {
    render(<SidePanel />)
    await screen.findByTestId('sidepanel-empty-state')

    act(() => {
      fireStorageChange(
        {
          [PENDING_SENTENCE_STORAGE_KEY]: {
            newValue: {
              sentence: 'Should be ignored.',
              word: '',
              sourceUrl: '',
              createdAt: 1,
            },
          },
        },
        'local'
      )
    })

    // Give any (incorrect) state update a chance to happen before asserting
    // the empty state is still showing.
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(screen.getByTestId('sidepanel-empty-state')).toBeInTheDocument()
  })

  // ADR-006: a word looked up via the page's word popover should show up in the
  // Side Panel's card list without ever triggering sentence translation.
  it('shows a card for a word looked up on the page, without calling translateSentence (ADR-006)', async () => {
    render(<SidePanel />)
    await screen.findByTestId('sidepanel-empty-state')

    act(() => {
      fireStorageChange(
        {
          [LATEST_PAGE_WORD_STORAGE_KEY]: {
            newValue: {
              word: 'serendipity',
              ecp: {
                English: 'serendipity',
                Chinese: '意外发现的美好事物',
                Pronunciation: '/ˌser.ənˈdɪp.ə.ti/',
                LoadCount: 5,
              },
              createdAt: 1,
            },
          },
        },
        'session'
      )
    })

    await waitFor(() => {
      const card = screen.getByTestId('sidepanel-card-serendipity')
      expect(card).toHaveTextContent('意外发现的美好事物')
      expect(card).toHaveTextContent('/ˌser.ənˈdɪp.ə.ti/')
      // No sentence context, so the AI context-translation UI must not
      // appear at all -- not even a loading state.
      expect(card).not.toHaveTextContent('Translating...')
    })
    expect(mockSendMessage).not.toHaveBeenCalled()
  })

  it('keeps the sentence (and its nested in-sentence word) visible when a page word lookup arrives afterwards (ADR-023, fixes the previous "sentence disappears" bug)', async () => {
    ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({
      [PENDING_SENTENCE_STORAGE_KEY]: {
        sentence: 'Cats are great pets.',
        word: '',
        sourceUrl: '',
        createdAt: 1,
      },
    })
    mockSendMessage.mockImplementation(async (message: { type: string; word?: string }) => {
      if (message.type === 'translateSentence') {
        return { success: true, chinese: '猫是很棒的宠物。' }
      }
      if (message.type === 'translateWordInContext') {
        return { success: true, chinese: `${message.word}在这句里的意思` }
      }
      if (message.type === 'getOneWord') {
        return {
          success: true,
          ecp: { English: message.word, Chinese: `${message.word}释义`, Pronunciation: `/${message.word}/` },
        }
      }
      return { success: false }
    })

    render(<SidePanel />)
    await screen.findByTestId('sidepanel-sentence')
    selectWord('great')
    await waitFor(() =>
      expect(screen.getByTestId('sidepanel-sentence-words')).toHaveTextContent('great在这句里的意思')
    )
    await waitFor(() =>
      expect(screen.getByTestId('sidepanel-chinese')).toHaveTextContent('猫是很棒的宠物。')
    )

    const callsBeforePageLookup = mockSendMessage.mock.calls.length

    act(() => {
      fireStorageChange(
        {
          [LATEST_PAGE_WORD_STORAGE_KEY]: {
            newValue: {
              word: 'serendipity',
              ecp: {
                English: 'serendipity',
                Chinese: '意外发现的美好事物',
                Pronunciation: '/ˌser.ənˈdɪp.ə.ti/',
                LoadCount: 5,
              },
              createdAt: 2,
            },
          },
        },
        'session'
      )
    })

    // The new top-level card appears, and the sentence -- and its nested
    // in-sentence word -- must stay exactly as they were.
    await screen.findByTestId('sidepanel-card-serendipity')
    expect(screen.getByTestId('sidepanel-sentence')).toHaveTextContent('Cats are great pets.')
    expect(screen.getByTestId('sidepanel-chinese')).toHaveTextContent('猫是很棒的宠物。')
    expect(screen.getByTestId('sidepanel-sentence-words')).toHaveTextContent('great在这句里的意思')

    // Newest arrival ('serendipity', a top-level card) renders above the
    // sentence entry (ADR-023 Decision 4: a page click always prepends to
    // the top-level list, never touching any sentence entry).
    const serendipityCard = screen.getByTestId('sidepanel-card-serendipity')
    const sentenceEntry = screen.getByTestId(/^sidepanel-sentence-entry-/)
    expect(
      serendipityCard.compareDocumentPosition(sentenceEntry) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()

    // No re-fetch: the card was populated directly from the storage payload.
    expect(mockSendMessage.mock.calls.length).toBe(callsBeforePageLookup)
  })

  it('keeps an existing page-lookup word card when a sentence translation is triggered afterwards (ADR-006 addendum)', async () => {
    mockSendMessage.mockResolvedValue({ success: true, chinese: '猫是很棒的宠物。' })

    render(<SidePanel />)
    await screen.findByTestId('sidepanel-empty-state')

    act(() => {
      fireStorageChange(
        {
          [LATEST_PAGE_WORD_STORAGE_KEY]: {
            newValue: {
              word: 'serendipity',
              ecp: {
                English: 'serendipity',
                Chinese: '意外发现的美好事物',
                Pronunciation: '/ˌser.ənˈdɪp.ə.ti/',
                LoadCount: 5,
              },
              createdAt: 1,
            },
          },
        },
        'session'
      )
    })
    await screen.findByTestId('sidepanel-card-serendipity')

    act(() => {
      fireStorageChange(
        {
          [PENDING_SENTENCE_STORAGE_KEY]: {
            newValue: {
              sentence: 'Cats are great pets.',
              word: '',
              sourceUrl: '',
              createdAt: 2,
            },
          },
        },
        'session'
      )
    })

    await waitFor(() =>
      expect(screen.getByTestId('sidepanel-chinese')).toHaveTextContent('猫是很棒的宠物。')
    )
    // The word card from the earlier page lookup must still be there.
    expect(screen.getByTestId('sidepanel-card-serendipity')).toBeInTheDocument()
  })

  // Pre-ADR-023, a page-lookup card and an in-sentence click on the same
  // word shared one global list, so this backfilled onto the same card
  // without re-fetching the dictionary half. ADR-023 Decision B2/C2
  // deliberately drops that cross-scope matching -- an in-sentence click
  // never searches the top-level list for a word to reuse -- so the two are
  // now independent cards, each fetched on its own.
  it('treats an in-sentence word click as independent from an existing top-level page-lookup card for the same word (ADR-023)', async () => {
    mockSendMessage.mockImplementation(async (message: { type: string; word?: string }) => {
      if (message.type === 'translateSentence') {
        return { success: true, chinese: '猫是很棒的宠物。' }
      }
      if (message.type === 'translateWordInContext') {
        return { success: true, chinese: `${message.word}在这句里的意思` }
      }
      if (message.type === 'getOneWord') {
        return {
          success: true,
          ecp: { English: message.word, Chinese: `${message.word}释义(重新查询)`, Pronunciation: `/${message.word}/` },
        }
      }
      return { success: false }
    })

    render(<SidePanel />)
    await screen.findByTestId('sidepanel-empty-state')

    // 1) Word looked up on the page first -- top-level card, dictionary data
    //    only, contextStatus 'none' (no sentence yet).
    act(() => {
      fireStorageChange(
        {
          [LATEST_PAGE_WORD_STORAGE_KEY]: {
            newValue: {
              word: 'cats',
              ecp: { English: 'cats', Chinese: '猫的复数', Pronunciation: '/kæts/', LoadCount: 2 },
              createdAt: 1,
            },
          },
        },
        'session'
      )
    })
    const topLevelCard = await screen.findByTestId('sidepanel-card-cats')
    expect(topLevelCard).toHaveTextContent('猫的复数')
    expect(topLevelCard).not.toHaveTextContent('Translating...')

    // 2) A sentence containing the same word arrives (e.g. via 整句翻译).
    act(() => {
      fireStorageChange(
        {
          [PENDING_SENTENCE_STORAGE_KEY]: {
            newValue: {
              sentence: 'Cats are great pets.',
              word: '',
              sourceUrl: '',
              createdAt: 2,
            },
          },
        },
        'session'
      )
    })
    await screen.findByTestId('sidepanel-sentence')
    // The page-lookup card is untouched by the new sentence context.
    expect(screen.getByTestId('sidepanel-card-cats')).toHaveTextContent('猫的复数')

    // 3) Clicking "Cats" inside the sentence fetches a fresh, separate card
    //    nested under the sentence -- it does not touch the top-level one.
    //    Both scopes now render a "cats" card, so disambiguate by container
    //    rather than relying on the word testid alone.
    selectWord('Cats')

    await waitFor(() =>
      expect(screen.getByTestId('sidepanel-sentence-words')).toHaveTextContent('cats在这句里的意思')
    )
    const nestedCard = within(screen.getByTestId('sidepanel-sentence-words')).getByTestId('sidepanel-card-cats')
    expect(nestedCard).toHaveTextContent('cats在这句里的意思')
    expect(nestedCard).toHaveTextContent('cats释义(重新查询)')

    // The top-level card is untouched -- still the original dictionary text.
    const topLevelCardAfter = screen.getAllByTestId('sidepanel-card-cats').find(el => el !== nestedCard)!
    expect(topLevelCardAfter).toHaveTextContent('猫的复数')
    expect(topLevelCardAfter).not.toHaveTextContent('cats释义(重新查询)')
  })

  // ADR-014: opening the panel from a page word click sends ONE combined AI
  // call that returns the whole-sentence translation AND that word's
  // in-context meaning; the panel highlights the clicked word in the
  // original and seeds its card without the user clicking it again.
  describe('opened from a page word click (ADR-014)', () => {
    const pendingWithWord = {
      [PENDING_SENTENCE_STORAGE_KEY]: {
        sentence: 'Cats are great pets.',
        word: 'great',
        sourceUrl: '',
        createdAt: 1,
      },
    }

    it('does not double-fetch when the anchor word is clicked in the sentence while translateSentenceWithWord is still in flight (ADR-023 race)', async () => {
      ;(chrome.storage.session.get as jest.Mock).mockResolvedValue(pendingWithWord)

      let resolveCombined: (value: BackgroundResponse) => void = () => {}
      let getOneWordCalls = 0
      let contextCalls = 0
      mockSendMessage.mockImplementation((message: { type: string; word?: string }) => {
        if (message.type === 'translateSentenceWithWord') {
          return new Promise(resolve => {
            resolveCombined = resolve
          })
        }
        if (message.type === 'getOneWord') {
          getOneWordCalls += 1
          return Promise.resolve({
            success: true,
            ecp: { English: message.word, Chinese: 'great词典', Pronunciation: '/greɪt/', LoadCount: 1 },
          })
        }
        if (message.type === 'translateWordInContext') {
          contextCalls += 1
          return Promise.resolve({ success: true, chinese: 'great语境义' })
        }
        return Promise.resolve({ success: false })
      })

      render(<SidePanel />)
      // The anchor word is highlighted (and clickable) as soon as the
      // sentence renders, before translateSentenceWithWord resolves.
      await screen.findByTestId('sidepanel-sentence')
      selectWord('great')

      await waitFor(() =>
        expect(screen.getByTestId('sidepanel-sentence-words')).toHaveTextContent('great语境义')
      )
      expect(getOneWordCalls).toBe(1)
      expect(contextCalls).toBe(1)

      resolveCombined({ success: true, chinese: '猫是很棒的宠物。', wordChinese: 'great极好的' })

      await waitFor(() =>
        expect(screen.getByTestId('sidepanel-chinese')).toHaveTextContent('猫是很棒的宠物。')
      )
      // Still only ever fetched once each -- no double Query Count
      // increment, no double AI charge for the same word.
      expect(getOneWordCalls).toBe(1)
      expect(contextCalls).toBe(1)
      // The context already loaded from the click is kept, not clobbered by
      // the combined response's wordChinese arriving after.
      expect(screen.getByTestId('sidepanel-sentence-words')).toHaveTextContent('great语境义')
    })

    it('sends translateSentenceWithWord (not translateSentence) and shows both halves', async () => {
      ;(chrome.storage.session.get as jest.Mock).mockResolvedValue(pendingWithWord)
      mockSendMessage.mockImplementation(async (message: { type: string; word?: string }) => {
        if (message.type === 'translateSentenceWithWord') {
          return { success: true, chinese: '猫是很棒的宠物。', wordChinese: '极好的' }
        }
        if (message.type === 'getOneWord') {
          return {
            success: true,
            ecp: { English: message.word, Chinese: 'great的词典释义', Pronunciation: '/greɪt/', LoadCount: 7 },
          }
        }
        return { success: false }
      })

      render(<SidePanel />)

      await waitFor(() =>
        expect(screen.getByTestId('sidepanel-chinese')).toHaveTextContent('猫是很棒的宠物。')
      )
      // Card for the clicked word is seeded automatically, 本句 meaning from
      // the SAME combined call (no separate translateWordInContext).
      await waitFor(() => {
        const card = screen.getByTestId('sidepanel-card-great')
        expect(card).toHaveTextContent('极好的')
        expect(card).toHaveTextContent('great的词典释义')
        expect(card).toHaveTextContent('/greɪt/')
      })
      expect(mockSendMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'translateSentence' })
      )
      expect(mockSendMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'translateWordInContext' })
      )
    })

    it('highlights every occurrence of the clicked word in the original', async () => {
      ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({
        [PENDING_SENTENCE_STORAGE_KEY]: {
          sentence: 'A great day for a great walk.',
          word: 'great',
          sourceUrl: '',
          createdAt: 1,
        },
      })
      mockSendMessage.mockResolvedValue({ success: true, chinese: '译文', wordChinese: '极好的' })

      render(<SidePanel />)

      const sentence = await screen.findByTestId('sidepanel-sentence')
      const highlighted = Array.from(
        sentence.querySelectorAll('[data-clicked-word="true"]')
      )
      expect(highlighted).toHaveLength(2)
      highlighted.forEach(el => expect(el).toHaveTextContent('great'))
    })

    it('falls back to a separate translateWordInContext when the model omits the word gloss', async () => {
      ;(chrome.storage.session.get as jest.Mock).mockResolvedValue(pendingWithWord)
      mockSendMessage.mockImplementation(async (message: { type: string; word?: string }) => {
        if (message.type === 'translateSentenceWithWord') {
          return { success: true, chinese: '猫是很棒的宠物。', wordChinese: '' }
        }
        if (message.type === 'translateWordInContext') {
          return { success: true, chinese: '兜底：极好的' }
        }
        if (message.type === 'getOneWord') {
          return { success: true, ecp: { English: message.word, Chinese: 'x', Pronunciation: '/greɪt/' } }
        }
        return { success: false }
      })

      render(<SidePanel />)

      await waitFor(() =>
        expect(screen.getByTestId('sidepanel-card-great')).toHaveTextContent('兜底：极好的')
      )
      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'translateWordInContext', word: 'great' })
      )
    })

    it('does not seed a card or highlight for a drag-selected sentence (no anchor word)', async () => {
      ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({
        [PENDING_SENTENCE_STORAGE_KEY]: {
          sentence: 'Cats are great pets.',
          word: '',
          sourceUrl: '',
          createdAt: 1,
        },
      })
      mockSendMessage.mockImplementation(async (message: { type: string }) => {
        if (message.type === 'translateSentence') {
          return { success: true, chinese: '猫是很棒的宠物。' }
        }
        return { success: false }
      })

      render(<SidePanel />)

      await waitFor(() =>
        expect(screen.getByTestId('sidepanel-chinese')).toHaveTextContent('猫是很棒的宠物。')
      )
      expect(mockSendMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'translateSentenceWithWord' })
      )
      expect(screen.queryAllByTestId(/^sidepanel-card-/)).toHaveLength(0)
      expect(screen.queryByTestId('sidepanel-sentence-words')).not.toBeInTheDocument()
      const sentence = screen.getByTestId('sidepanel-sentence')
      expect(sentence.querySelector('[data-clicked-word]')).toBeNull()
    })
  })

  describe('drag-select phrase lookup in the sentence (ADR-017)', () => {
    const seedSentence = async (chinese = '猫是很棒的宠物。') => {
      ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({
        [PENDING_SENTENCE_STORAGE_KEY]: {
          sentence: SENTENCE,
          word: '',
          sourceUrl: '',
          createdAt: 1,
        },
      })
      mockSendMessage.mockImplementation(async (message: { type: string }) => {
        if (message.type === 'translateSentence') return { success: true, chinese }
        if (message.type === 'translateWordInContext') {
          return { success: true, chinese: '很棒的宠物（本句）' }
        }
        return { success: false }
      })
      render(<SidePanel />)
      await screen.findByTestId('sidepanel-sentence')
    }

    it('pops a confirm button, and sends no lookup yet, when 2+ words are selected', async () => {
      await seedSentence()

      selectWord('great pets')

      expect(await screen.findByTestId('sidepanel-phrase-confirm')).toBeInTheDocument()
      expect(mockSendMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'translateWordInContext' })
      )
    })

    it('confirms the selection into a phrase card with one in-context lookup', async () => {
      const user = userEvent.setup()
      await seedSentence()

      selectWord('great pets')
      await user.click(await screen.findByTestId('sidepanel-phrase-confirm'))

      const card = await screen.findByTestId('sidepanel-card-great pets')
      expect(card).toHaveTextContent('很棒的宠物（本句）')
      expect(within(card).queryByText(/Loading phonetics/)).not.toBeInTheDocument()
      expect(
        mockSendMessage.mock.calls.filter(
          ([m]) => m.type === 'translateWordInContext'
        )
      ).toHaveLength(1)
      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'translateWordInContext',
          word: 'great pets',
          sentence: SENTENCE,
        })
      )
      expect(screen.queryByTestId('sidepanel-phrase-confirm')).not.toBeInTheDocument()
    })

    it('snaps a part-word drag out to whole words before looking up', async () => {
      const user = userEvent.setup()
      await seedSentence()

      // "Cats are grea|t pet|s." -> phrase should be "great pets"
      selectWord('reat pet')
      await user.click(await screen.findByTestId('sidepanel-phrase-confirm'))

      await screen.findByTestId('sidepanel-card-great pets')
    })

    it('dismisses the confirm button on Escape without looking anything up', async () => {
      const user = userEvent.setup()
      await seedSentence()

      selectWord('great pets')
      const btn = await screen.findByTestId('sidepanel-phrase-confirm')
      expect(btn).toHaveFocus() // autofocus so a keyboard selection can confirm/cancel
      await user.keyboard('{Escape}')

      await waitFor(() =>
        expect(screen.queryByTestId('sidepanel-phrase-confirm')).not.toBeInTheDocument()
      )
      expect(mockSendMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'translateWordInContext' })
      )
    })

    it('does not pop the confirm button when the whole sentence is selected', async () => {
      await seedSentence()

      selectWord(SENTENCE)

      await waitFor(() => expect(mockSendMessage).toHaveBeenCalled())
      expect(screen.queryByTestId('sidepanel-phrase-confirm')).not.toBeInTheDocument()
    })

    it('re-selecting a phrase already in the list just moves its card up, no new lookup', async () => {
      const user = userEvent.setup()
      await seedSentence()

      selectWord('great pets')
      await user.click(await screen.findByTestId('sidepanel-phrase-confirm'))
      await screen.findByTestId('sidepanel-card-great pets')

      selectWord('great pets')
      await waitFor(() =>
        expect(screen.queryByTestId('sidepanel-phrase-confirm')).not.toBeInTheDocument()
      )
      expect(
        mockSendMessage.mock.calls.filter(([m]) => m.type === 'translateWordInContext')
      ).toHaveLength(1)
    })
  })

  describe('unified history list (ADR-023)', () => {
    it('keeps every translated sentence in the panel, newest on top', async () => {
      ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({
        [PENDING_SENTENCE_STORAGE_KEY]: {
          sentence: 'First sentence.',
          word: '',
          sourceUrl: '',
          createdAt: 1,
        },
      })
      mockSendMessage.mockImplementation(async (message: { sentence?: string }) => {
        if (message.sentence === 'First sentence.') return { success: true, chinese: '第一句。' }
        if (message.sentence === 'Second sentence.') return { success: true, chinese: '第二句。' }
        return { success: false }
      })

      render(<SidePanel />)
      await waitFor(() => expect(screen.getByTestId('sidepanel-chinese')).toHaveTextContent('第一句。'))

      act(() => {
        fireStorageChange(
          {
            [PENDING_SENTENCE_STORAGE_KEY]: {
              newValue: { sentence: 'Second sentence.', word: '', sourceUrl: '', createdAt: 2 },
            },
          },
          'session'
        )
      })

      await waitFor(() => {
        const sentences = screen.getAllByTestId('sidepanel-sentence')
        expect(sentences.map(s => s.textContent)).toEqual(['Second sentence.', 'First sentence.'])
      })
      const chineses = screen.getAllByTestId('sidepanel-chinese')
      expect(chineses.map(c => c.textContent)).toEqual(['第二句。', '第一句。'])
    })

    it('nests a word looked up inside a historical (non-newest) sentence there, without moving that sentence in the list', async () => {
      ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({
        [PENDING_SENTENCE_STORAGE_KEY]: {
          sentence: 'Cats are great pets.',
          word: '',
          sourceUrl: '',
          createdAt: 1,
        },
      })
      mockSendMessage.mockImplementation(
        async (message: { type: string; sentence?: string; word?: string }) => {
          if (message.type === 'translateSentence' && message.sentence === 'Cats are great pets.') {
            return { success: true, chinese: '猫是很棒的宠物。' }
          }
          if (message.type === 'translateSentence' && message.sentence === 'Dogs are loyal friends.') {
            return { success: true, chinese: '狗是忠诚的朋友。' }
          }
          if (message.type === 'translateWordInContext') {
            return { success: true, chinese: `${message.word}在这句里的意思` }
          }
          if (message.type === 'getOneWord') {
            return {
              success: true,
              ecp: { English: message.word, Chinese: `${message.word}释义`, Pronunciation: `/${message.word}/` },
            }
          }
          return { success: false }
        }
      )

      render(<SidePanel />)
      await waitFor(() =>
        expect(screen.getByTestId('sidepanel-chinese')).toHaveTextContent('猫是很棒的宠物。')
      )

      act(() => {
        fireStorageChange(
          {
            [PENDING_SENTENCE_STORAGE_KEY]: {
              newValue: { sentence: 'Dogs are loyal friends.', word: '', sourceUrl: '', createdAt: 2 },
            },
          },
          'session'
        )
      })

      await waitFor(() => {
        const sentences = screen.getAllByTestId('sidepanel-sentence')
        expect(sentences.map(s => s.textContent)).toEqual([
          'Dogs are loyal friends.',
          'Cats are great pets.',
        ])
      })

      // Click a word inside the OLDER sentence, now in the #2 slot.
      const historicalSentenceEl = screen.getAllByTestId('sidepanel-sentence')[1]
      selectWord('great', 'Cats are great pets.', historicalSentenceEl)

      await waitFor(() => {
        const entryContainers = screen.getAllByTestId(/^sidepanel-sentence-entry-/)
        expect(within(entryContainers[1]).getByTestId('sidepanel-sentence-words')).toHaveTextContent(
          'great在这句里的意思'
        )
      })

      // Order is unchanged -- the sentence clicked into did not jump to the top.
      const sentencesAfter = screen.getAllByTestId('sidepanel-sentence')
      expect(sentencesAfter.map(s => s.textContent)).toEqual([
        'Dogs are loyal friends.',
        'Cats are great pets.',
      ])
      // The newer sentence's own nested list is untouched (still empty).
      const entryContainersAfter = screen.getAllByTestId(/^sidepanel-sentence-entry-/)
      expect(within(entryContainersAfter[0]).queryByTestId('sidepanel-sentence-words')).not.toBeInTheDocument()
    })
  })
})
