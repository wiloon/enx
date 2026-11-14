import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
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
import { BackgroundResponse } from '@/types'
import { latestPageWordKey, pendingSentenceKey } from '@/lib/sidePanel'
import { WORD_HIGHLIGHT_KEY } from '@/config/preferences'
import SidePanel from '../SidePanel'

// ADR-050: the panel belongs to the tab named in its URL and only reads that
// tab's keys. Every test below runs as the panel of tab 7.
const PANEL_TAB_ID = 7
const PENDING_SENTENCE_STORAGE_KEY = pendingSentenceKey(PANEL_TAB_ID)
const LATEST_PAGE_WORD_STORAGE_KEY = latestPageWordKey(PANEL_TAB_ID)

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
const selectWord = (
  word: string,
  sentence = SENTENCE,
  container?: HTMLElement
) => {
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

// The text of every Range registered under a CSS.highlights name (ADR-053:
// the sentence original's marks are Highlight API Ranges, not elements).
const highlightTexts = (name: string): string[] =>
  [...(CSS.highlights.get(name) ?? [])].map(range => range.toString())

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
    window.history.replaceState({}, '', `/sidepanel.html?tabId=${PANEL_TAB_ID}`)
    storageChangeListeners = []
    CSS.highlights.clear()
    ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({})
    ;(chrome.storage.local.get as jest.Mock).mockResolvedValue({})
    ;(chrome.tabs.sendMessage as jest.Mock).mockResolvedValue(undefined)
    ;(chrome.storage.onChanged.addListener as jest.Mock).mockImplementation(
      (listener: StorageChangeListener) => {
        storageChangeListeners.push(listener)
      }
    )
    ;(chrome.storage.onChanged.removeListener as jest.Mock).mockImplementation(
      () => {}
    )
  })

  it("ignores another tab's sentence (ADR-050)", async () => {
    render(<SidePanel />)
    await screen.findByTestId('sidepanel-empty-state')

    act(() => {
      fireStorageChange(
        {
          [pendingSentenceKey(8)]: {
            newValue: {
              sentence: SENTENCE,
              word: 'great',
              createdAt: Date.now(),
            },
          },
        },
        'session'
      )
    })

    expect(screen.getByTestId('sidepanel-empty-state')).toBeInTheDocument()
    expect(mockSendMessage).not.toHaveBeenCalled()
  })

  it('shows the empty state and reads nothing without an owning tab (ADR-050)', async () => {
    window.history.replaceState({}, '', '/sidepanel.html')
    render(<SidePanel />)

    expect(
      await screen.findByTestId('sidepanel-empty-state')
    ).toBeInTheDocument()
    expect(chrome.storage.session.get).not.toHaveBeenCalled()
  })

  it('shows the empty state when there is no pending sentence context (spec §4.1)', async () => {
    render(<SidePanel />)
    expect(
      await screen.findByTestId('sidepanel-empty-state')
    ).toBeInTheDocument()
  })

  it('loads and displays the sentence + translation once a pending context is stored', async () => {
    ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({
      [PENDING_SENTENCE_STORAGE_KEY]: {
        sentence: 'Cats are great pets.',
        word: '',
        createdAt: 1,
      },
    })
    mockSendMessage.mockResolvedValue({
      success: true,
      chinese: '猫是很棒的宠物。',
    })

    render(<SidePanel />)

    expect(await screen.findByTestId('sidepanel-sentence')).toHaveTextContent(
      'Cats are great pets.'
    )
    await waitFor(() =>
      expect(screen.getByTestId('sidepanel-chinese')).toHaveTextContent(
        '猫是很棒的宠物。'
      )
    )
  })

  it('renders the original sentence as selectable plain text, not per-word buttons (ADR-017)', async () => {
    ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({
      [PENDING_SENTENCE_STORAGE_KEY]: {
        sentence: 'Cats are great pets.',
        word: '',
        createdAt: 1,
      },
    })
    mockSendMessage.mockResolvedValue({
      success: true,
      chinese: '猫是很棒的宠物。',
    })

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

  it('shows one failure shared by the sentence and its anchor word once, and its Retry recovers both', async () => {
    ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({
      [PENDING_SENTENCE_STORAGE_KEY]: {
        sentence: SENTENCE,
        word: 'great',
        createdAt: 1,
      },
    })
    let apiDown = true
    mockSendMessage.mockImplementation(
      async (message: { type: string; word?: string }) => {
        if (apiDown) {
          return {
            success: false,
            error: 'Service temporarily unavailable. Please retry.',
            status: 503,
          }
        }
        if (message.type === 'translateSentence') {
          return { success: true, chinese: '猫是很棒的宠物。' }
        }
        if (message.type === 'translateWordInContext') {
          return { success: true, chinese: '很棒的' }
        }
        if (message.type === 'getOneWord') {
          return {
            success: true,
            ecp: { English: 'great', Chinese: 'a. 伟大的', Pronunciation: '' },
          }
        }
        return { success: false }
      }
    )

    render(<SidePanel />)

    expect(await screen.findByTestId('sidepanel-error')).toHaveTextContent(
      'Service temporarily unavailable. Please retry.'
    )
    await screen.findByTestId('sidepanel-card-great')
    await waitFor(() =>
      expect(
        screen.getAllByText('Service temporarily unavailable. Please retry.')
      ).toHaveLength(1)
    )

    apiDown = false
    await userEvent.click(screen.getByTestId('sidepanel-retry-sentence'))

    expect(await screen.findByTestId('sidepanel-chinese')).toHaveTextContent(
      '猫是很棒的宠物。'
    )
    expect(
      await within(screen.getByTestId('sidepanel-card-great')).findByText(
        '很棒的'
      )
    ).toBeInTheDocument()
    expect(
      screen.queryByText(/temporarily unavailable/)
    ).not.toBeInTheDocument()
  })

  it('shows a word card failure once when its dictionary and AI halves fail alike', async () => {
    ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({
      [PENDING_SENTENCE_STORAGE_KEY]: {
        sentence: SENTENCE,
        word: '',
        createdAt: 1,
      },
    })
    mockSendMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type === 'translateSentence') {
        return { success: true, chinese: '猫是很棒的宠物。' }
      }
      return {
        success: false,
        error: 'Service temporarily unavailable. Please retry.',
        status: 503,
      }
    })

    render(<SidePanel />)
    await screen.findByTestId('sidepanel-chinese')
    selectWord('great')

    const errorRow = await screen.findByTestId('sidepanel-context-error-great')
    expect(errorRow).toHaveTextContent(
      'Service temporarily unavailable. Please retry.'
    )
    expect(
      within(errorRow).getByTestId('sidepanel-retry-context-great')
    ).toBeInTheDocument()
    expect(
      screen.queryByTestId('sidepanel-dictionary-error-great')
    ).not.toBeInTheDocument()
  })

  it('a cached read-only anchor uses the carried page count and sends no count POST', async () => {
    ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({
      [PENDING_SENTENCE_STORAGE_KEY]: {
        sentence: SENTENCE,
        word: 'great',
        createdAt: 1,
        wordStates: {
          great: {
            Id: 'great-id',
            English: 'great',
            LoadCount: 11,
            Known: false,
            WordType: 0,
          },
        },
      },
    })
    mockSendMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type === 'getOneWord')
        return {
          success: true,
          ecp: {
            Id: 'great-id',
            English: 'great',
            Chinese: '伟大的',
            Pronunciation: '',
            WordType: 0,
          },
        }
      return { success: true, chinese: '很棒的' }
    })
    render(<SidePanel />)
    await screen.findByText('伟大的')
    expect(screen.getByTitle('Looked up 11 times')).toBeInTheDocument()
    expect(
      mockSendMessage.mock.calls.filter(
        ([message]) => message.type === 'recordWordLookup'
      )
    ).toEqual([])
  })

  it('retains a cached count that completes during Clear so Undo shows the updated card', async () => {
    ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({
      [PENDING_SENTENCE_STORAGE_KEY]: {
        sentence: SENTENCE,
        word: '',
        createdAt: 1,
      },
    })
    let finish!: (r: BackgroundResponse) => void
    mockSendMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type === 'getOneWord')
        return {
          success: true,
          ecp: {
            Id: 'great-id',
            English: 'great',
            Chinese: '伟大的',
            Pronunciation: '',
            WordType: 0,
          },
        }
      if (message.type === 'recordWordLookup')
        return new Promise(resolve => {
          finish = resolve
        })
      return { success: true, chinese: '很棒的' }
    })
    render(<SidePanel />)
    await screen.findByTestId('sidepanel-sentence')
    selectWord('great')
    await screen.findByText('伟大的')
    fireEvent.click(screen.getByTestId('sidepanel-clear-all'))
    await act(async () =>
      finish({ success: true, queryCount: 17, known: false })
    )
    fireEvent.click(screen.getByTestId('sidepanel-undo-clear'))
    expect(await screen.findByTitle('Looked up 17 times')).toBeInTheDocument()
  })

  it('pauses stale-cache recovery while the card is cleared, then resumes it once on Undo', async () => {
    ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({
      [PENDING_SENTENCE_STORAGE_KEY]: {
        sentence: SENTENCE,
        word: '',
        createdAt: 1,
      },
    })
    let finish!: (r: BackgroundResponse) => void
    let gets = 0
    mockSendMessage.mockImplementation(
      async (message: { type: string; wordId?: string }) => {
        if (message.type === 'getOneWord') {
          gets++
          return {
            success: true,
            ecp: {
              Id: gets === 1 ? 'old-id' : 'new-id',
              English: 'great',
              Chinese: '伟大的',
              Pronunciation: '',
              WordType: 0,
            },
          }
        }
        if (message.type === 'recordWordLookup')
          return message.wordId === 'old-id'
            ? new Promise(resolve => {
                finish = resolve
              })
            : { success: true, queryCount: 17, known: false }
        return { success: true, chinese: '很棒的' }
      }
    )
    render(<SidePanel />)
    await screen.findByTestId('sidepanel-sentence')
    selectWord('great')
    await screen.findByText('伟大的')
    fireEvent.click(screen.getByTestId('sidepanel-clear-all'))
    await act(async () => finish({ success: false, status: 404 }))
    expect(gets).toBe(1)
    fireEvent.click(screen.getByTestId('sidepanel-undo-clear'))
    expect(await screen.findByTitle('Looked up 17 times')).toBeInTheDocument()
    expect(gets).toBe(2)
  })

  it('keeps a cached definition visible while its count POST waits and after a quota refusal', async () => {
    ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({
      [PENDING_SENTENCE_STORAGE_KEY]: {
        sentence: SENTENCE,
        word: '',
        createdAt: 1,
      },
    })
    let finish!: (r: BackgroundResponse) => void
    mockSendMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type === 'getOneWord')
        return {
          success: true,
          ecp: {
            Id: 'great-id',
            English: 'great',
            Chinese: '伟大的',
            Pronunciation: '',
            WordType: 0,
          },
        }
      if (message.type === 'recordWordLookup')
        return new Promise(resolve => {
          finish = resolve
        })
      return { success: true, chinese: '很棒的' }
    })
    render(<SidePanel />)
    await screen.findByTestId('sidepanel-sentence')
    selectWord('great')
    const definition = await screen.findByText('伟大的')
    expect(mockSendMessage).toHaveBeenCalledWith({
      type: 'recordWordLookup',
      wordId: 'great-id',
    })
    await act(async () =>
      finish({ success: false, status: 429, code: 'lookup_quota_exceeded' })
    )
    expect(definition).toBeInTheDocument()
    expect(
      await screen.findByTestId('sidepanel-dictionary-error-great')
    ).toHaveTextContent("You've used up today's free lookups")
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled()
  })

  it('shows an upgrade link instead of the raw message when sentence translation fails with 402 (insufficient AI credit)', async () => {
    ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({
      [PENDING_SENTENCE_STORAGE_KEY]: {
        sentence: 'Cats are great pets.',
        word: '',
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
        createdAt: 1,
      },
    })
    mockSendMessage.mockImplementation(
      async (message: { type: string; word?: string }) => {
        if (message.type === 'translateSentence') {
          return { success: true, chinese: '猫是很棒的宠物。' }
        }
        if (message.type === 'translateWordInContext') {
          return {
            success: false,
            error: 'Insufficient credit. Please add credit or subscribe.',
            status: 402,
          }
        }
        if (message.type === 'getOneWord') {
          return {
            success: true,
            ecp: {
              English: message.word,
              Chinese: 'unused',
              Pronunciation: '/greɪt/',
            },
          }
        }
        return { success: false }
      }
    )

    render(<SidePanel />)
    await screen.findByTestId('sidepanel-sentence')
    selectWord('great')

    const errorRow = await screen.findByTestId('sidepanel-context-error-great')
    expect(errorRow).toHaveTextContent('Not enough AI translation credit')
    expect(
      within(errorRow).getByText('Subscribe / add credit')
    ).toHaveAttribute('href', 'http://localhost:3000/billing')
    // Retry must still be there -- topping up in another tab and retrying
    // here should work without reopening the panel.
    expect(
      within(errorRow).getByTestId('sidepanel-retry-context-great')
    ).toBeInTheDocument()
  })

  it('shows an upgrade link (not the raw error) when the dictionary lookup hits the daily quota (429)', async () => {
    ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({
      [PENDING_SENTENCE_STORAGE_KEY]: {
        sentence: 'Cats are great pets.',
        word: '',
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
          error:
            'Daily dictionary lookup limit reached. Upgrade to enx Pro for unlimited lookups.',
          status: 429,
        }
      }
      return { success: false }
    })

    render(<SidePanel />)
    await screen.findByTestId('sidepanel-sentence')
    selectWord('great')

    const errorRow = await screen.findByTestId(
      'sidepanel-dictionary-error-great'
    )
    expect(errorRow).toHaveTextContent("You've used up today's free lookups")
    expect(errorRow).not.toHaveTextContent('Upgrade to enx Pro')
    expect(
      within(errorRow).getByText('Subscribe / add credit')
    ).toHaveAttribute('href', 'http://localhost:3000/billing')
  })

  // ADR-060 Decision 4: the request rate limit's 429 is not the quota. It
  // says to slow down, and does not send the user to billing.
  it.each([
    [
      'the request rate limit',
      'too_many_requests',
      'Too many requests. Please slow down and try again in a moment.',
      'Too many requests. Please slow down and try again in a moment.',
      false,
    ],
    [
      'the daily quota, by its code',
      'lookup_quota_exceeded',
      'Daily dictionary lookup limit reached.',
      "You've used up today's free lookups",
      true,
    ],
  ])(
    'tells a 429 from %s by its code',
    async (_name, code, error, shown, upgrade) => {
      ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({
        [PENDING_SENTENCE_STORAGE_KEY]: {
          sentence: 'Cats are great pets.',
          word: '',
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
          return { success: false, error, status: 429, code }
        }
        return { success: false }
      })

      render(<SidePanel />)
      await screen.findByTestId('sidepanel-sentence')
      selectWord('great')

      const errorRow = await screen.findByTestId(
        'sidepanel-dictionary-error-great'
      )
      expect(errorRow).toHaveTextContent(shown)
      expect(errorRow).not.toHaveTextContent(/session expired/i)
      expect(
        within(errorRow).queryByText('Subscribe / add credit') !== null
      ).toBe(upgrade)
    }
  )

  it('appends word cards on click instead of replacing the previous one, newest on top (spec §3.9/§4.5)', async () => {
    ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({
      [PENDING_SENTENCE_STORAGE_KEY]: {
        sentence: 'Cats are great pets.',
        word: '',
        createdAt: 1,
      },
    })
    mockSendMessage.mockImplementation(
      async (message: { type: string; word?: string }) => {
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
              Id: `${message.word}-id`,
              English: message.word,
              Chinese: `${message.word}的通用词典释义`,
              Pronunciation: `/${message.word}/`,
            },
          }
        }
        if (message.type === 'recordWordLookup') {
          return { success: true, queryCount: 3, known: false }
        }
        return { success: false }
      }
    )

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
      // The lookup count reads as the repeat icon and a bare "3", as in the
      // word popover; the full wording lives in the hover title and, for
      // screen readers, in visually hidden text.
      for (const word of ['cats', 'great']) {
        const count = within(
          screen.getByTestId(`sidepanel-card-${word}`)
        ).getByTitle('Looked up 3 times')
        expect(count).toHaveTextContent('3')
        expect(count).not.toHaveTextContent('×')
        expect(count).toHaveTextContent('Looked up 3 times')
      }
    })

    // Newest click ('great') renders above the earlier one ('cats').
    const cards = screen.getAllByTestId(/^sidepanel-card-/)
    expect(cards.map(c => c.getAttribute('data-testid'))).toEqual([
      'sidepanel-card-great',
      'sidepanel-card-cats',
    ])
  })

  it('records no reading position for a word clicked in the panel (ADR-081 Decision 1)', async () => {
    ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({
      [PENDING_SENTENCE_STORAGE_KEY]: {
        sentence: SENTENCE,
        word: '',
        createdAt: 1,
      },
    })
    mockSendMessage.mockImplementation(async (message: { type: string }) =>
      message.type === 'translateSentence'
        ? { success: true, chinese: '猫是很棒的宠物。' }
        : { success: true }
    )

    render(<SidePanel />)
    await screen.findByTestId('sidepanel-sentence')
    selectWord('great')

    await waitFor(() =>
      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'translateWordInContext' })
      )
    )
    const messages = [
      ...mockSendMessage.mock.calls,
      ...(chrome.runtime.sendMessage as jest.Mock).mock.calls,
      ...(chrome.tabs.sendMessage as jest.Mock).mock.calls,
    ].flat()
    expect(messages).not.toContainEqual(
      expect.objectContaining({ type: 'recordReadingPosition' })
    )
  })

  it('still shows dictionary info when the contextual translation fails, and vice versa (spec §4.5, 互不阻塞)', async () => {
    ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({
      [PENDING_SENTENCE_STORAGE_KEY]: {
        sentence: 'Cats are great pets.',
        word: '',
        createdAt: 1,
      },
    })
    mockSendMessage.mockImplementation(
      async (message: { type: string; word?: string }) => {
        if (message.type === 'translateSentence') {
          return { success: true, chinese: '猫是很棒的宠物。' }
        }
        if (message.type === 'translateWordInContext') {
          return { success: false, error: 'translation service unavailable' }
        }
        if (message.type === 'getOneWord') {
          return {
            success: true,
            ecp: {
              English: message.word,
              Chinese: 'unused',
              Pronunciation: '/greɪt/',
            },
          }
        }
        return { success: false }
      }
    )

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
    expect(
      within(card).queryByText(/Loading phonetics/)
    ).not.toBeInTheDocument()
    expect(
      within(card).queryByText(/Loading dictionary definition/)
    ).not.toBeInTheDocument()
  })

  it('shows an error + retry on a phrase card, same as a word card (ADR-008)', async () => {
    const fullSentence =
      'Your session has just expired mid-sentence for this phrase test.'
    ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({
      [PENDING_SENTENCE_STORAGE_KEY]: {
        sentence: fullSentence,
        word: '',
        phrase: 'expired mid-sentence',
        createdAt: 1,
      },
    })
    let callCount = 0
    mockSendMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type === 'translateWordInContext') {
        callCount += 1
        if (callCount === 1) {
          return {
            success: false,
            error: 'Your session has expired. Please login again.',
          }
        }
        return { success: true, chinese: '句子中途过期' }
      }
      return { success: false }
    })

    const user = userEvent.setup()
    render(<SidePanel />)

    const errorRow = await screen.findByTestId(
      'sidepanel-context-error-expired mid-sentence'
    )
    expect(errorRow).toHaveTextContent(
      'Your session has expired. Please login again.'
    )

    await user.click(
      within(errorRow).getByTestId(
        'sidepanel-retry-context-expired mid-sentence'
      )
    )

    await waitFor(() => {
      expect(
        screen.queryByTestId('sidepanel-context-error-expired mid-sentence')
      ).not.toBeInTheDocument()
      expect(
        screen.getByTestId('sidepanel-card-expired mid-sentence')
      ).toHaveTextContent('句子中途过期')
    })
    expect(callCount).toBe(2)
  })

  it('lets the user retry a failed contextual translation (e.g. session expiry) instead of leaving the card stuck', async () => {
    ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({
      [PENDING_SENTENCE_STORAGE_KEY]: {
        sentence: 'Cats are great pets.',
        word: '',
        createdAt: 1,
      },
    })
    let contextCallCount = 0
    mockSendMessage.mockImplementation(
      async (message: { type: string; word?: string }) => {
        if (message.type === 'translateSentence') {
          return { success: true, chinese: '猫是很棒的宠物。' }
        }
        if (message.type === 'translateWordInContext') {
          contextCallCount += 1
          if (contextCallCount === 1) {
            return {
              success: false,
              error: 'Your session has expired. Please login again.',
            }
          }
          return { success: true, chinese: '很棒的' }
        }
        if (message.type === 'getOneWord') {
          return {
            success: true,
            ecp: {
              English: message.word,
              Chinese: 'unused',
              Pronunciation: '/greɪt/',
            },
          }
        }
        return { success: false }
      }
    )

    const user = userEvent.setup()
    render(<SidePanel />)
    await screen.findByTestId('sidepanel-sentence')

    selectWord('great')

    const errorRow = await screen.findByTestId('sidepanel-context-error-great')
    expect(errorRow).toHaveTextContent(
      'Your session has expired. Please login again.'
    )

    await user.click(
      within(errorRow).getByTestId('sidepanel-retry-context-great')
    )

    await waitFor(() => {
      expect(
        screen.queryByTestId('sidepanel-context-error-great')
      ).not.toBeInTheDocument()
      expect(screen.getByTestId('sidepanel-sentence-words')).toHaveTextContent(
        '很棒的'
      )
    })
    expect(contextCallCount).toBe(2)
  })

  // #236: a request that failed because the session ended offers Sign in,
  // in amber, instead of a Retry that would fail again.
  describe('a session-expired failure', () => {
    const SIGNED_OUT =
      "You've been signed out. Sign in to keep looking up words."
    const EXPIRED = {
      success: false,
      error: 'Your session has expired. Please login again.',
      sessionExpired: true,
    }

    const answer = (overrides: Record<string, unknown>) =>
      mockSendMessage.mockImplementation(
        async (message: { type: string; word?: string }) => {
          if (message.type in overrides) return overrides[message.type]
          if (message.type === 'translateSentence') {
            return { success: true, chinese: '猫是很棒的宠物。' }
          }
          if (message.type === 'getOneWord') {
            return {
              success: true,
              ecp: {
                English: message.word,
                Chinese: '大的',
                Pronunciation: '',
              },
            }
          }
          if (message.type === 'translateWordInContext') {
            return { success: true, chinese: '很棒的' }
          }
          return { success: false }
        }
      )

    beforeEach(() => {
      ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({
        [PENDING_SENTENCE_STORAGE_KEY]: {
          sentence: SENTENCE,
          word: '',
          createdAt: 1,
        },
      })
    })

    it('renders the sentence row signed out, with Sign in and no Retry', async () => {
      answer({ translateSentence: EXPIRED })
      const user = userEvent.setup()
      render(<SidePanel />)

      const row = await screen.findByTestId('sidepanel-signed-out')
      expect(row).toHaveTextContent(SIGNED_OUT)
      expect(row).not.toHaveTextContent('Please login again')
      expect(screen.queryByTestId('sidepanel-retry-sentence')).toBeNull()

      await user.click(within(row).getByRole('button', { name: 'Sign in' }))
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        action: 'openWebSignIn',
      })
    })

    it('renders the context row signed out, with Sign in and no Retry', async () => {
      answer({ translateWordInContext: EXPIRED })
      render(<SidePanel />)
      await screen.findByTestId('sidepanel-sentence')

      selectWord('great')

      const row = await screen.findByTestId(
        'sidepanel-context-signed-out-great'
      )
      expect(row).toHaveTextContent(SIGNED_OUT)
      expect(
        within(row).getByRole('button', { name: 'Sign in' })
      ).toBeInTheDocument()
      expect(screen.queryByTestId('sidepanel-retry-context-great')).toBeNull()
    })

    it('renders the dictionary row signed out, with Sign in', async () => {
      answer({ getOneWord: EXPIRED })
      render(<SidePanel />)
      await screen.findByTestId('sidepanel-sentence')

      selectWord('great')

      const row = await screen.findByTestId(
        'sidepanel-dictionary-signed-out-great'
      )
      expect(row).toHaveTextContent(SIGNED_OUT)
      expect(
        within(row).getByRole('button', { name: 'Sign in' })
      ).toBeInTheDocument()
    })

    it('leaves an ordinary failure with its destructive Retry', async () => {
      answer({
        translateSentence: { success: false, error: 'Translation failed' },
      })
      render(<SidePanel />)

      const row = await screen.findByTestId('sidepanel-error')
      expect(row).toHaveClass('text-destructive')
      expect(screen.getByTestId('sidepanel-retry-sentence')).toBeInTheDocument()
      expect(screen.queryByTestId('sidepanel-signed-out')).toBeNull()
    })
  })

  // When the dictionary lookup itself never resolved (e.g. the same session
  // expiry broke both halves), retry must redo the whole dictionary-first
  // chain -- not just re-run the AI call with no definition to compare
  // against.
  it('retries the dictionary lookup too when it never resolved, not just the AI call', async () => {
    ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({
      [PENDING_SENTENCE_STORAGE_KEY]: {
        sentence: 'Cats are great pets.',
        word: '',
        createdAt: 1,
      },
    })
    let getOneWordCalls = 0
    let contextCalls = 0
    mockSendMessage.mockImplementation(
      async (message: {
        type: string
        word?: string
        dictionaryChinese?: string
      }) => {
        if (message.type === 'translateSentence') {
          return { success: true, chinese: '猫是很棒的宠物。' }
        }
        if (message.type === 'getOneWord') {
          getOneWordCalls += 1
          if (getOneWordCalls === 1) {
            return {
              success: false,
              error: 'Your session has expired. Please login again.',
            }
          }
          return {
            success: true,
            ecp: {
              English: message.word,
              Chinese: 'great的词典释义',
              Pronunciation: '/greɪt/',
            },
          }
        }
        if (message.type === 'translateWordInContext') {
          contextCalls += 1
          if (contextCalls === 1) {
            return {
              success: false,
              error: 'Your session has expired. Please login again.',
            }
          }
          return { success: true, chinese: '很棒的' }
        }
        return { success: false }
      }
    )

    const user = userEvent.setup()
    render(<SidePanel />)
    await screen.findByTestId('sidepanel-sentence')

    selectWord('great')

    const errorRow = await screen.findByTestId('sidepanel-context-error-great')
    await user.click(
      within(errorRow).getByTestId('sidepanel-retry-context-great')
    )

    await waitFor(() => {
      expect(
        screen.queryByTestId('sidepanel-context-error-great')
      ).not.toBeInTheDocument()
      const card = screen.getByTestId('sidepanel-card-great')
      expect(card).toHaveTextContent('很棒的')
      expect(card).toHaveTextContent('great的词典释义')
    })
    expect(getOneWordCalls).toBe(2)
    expect(contextCalls).toBe(2)
    // The successful retry's AI call had the dictionary definition to
    // compare against, unlike the first attempt.
    expect(mockSendMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'translateWordInContext',
        word: 'great',
        dictionaryChinese: 'great的词典释义',
      })
    )
  })

  it('renders the card progressively: dictionary info appears before the slower AI context translation resolves (spec §3.9)', async () => {
    ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({
      [PENDING_SENTENCE_STORAGE_KEY]: {
        sentence: 'Cats are great pets.',
        word: '',
        createdAt: 1,
      },
    })

    let resolveContext: (value: BackgroundResponse) => void = () => {}
    mockSendMessage.mockImplementation(
      (message: { type: string; word?: string }) => {
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
            ecp: {
              English: message.word,
              Chinese: '很棒的',
              Pronunciation: '/greɪt/',
              LoadCount: 1,
            },
          })
        }
        return Promise.resolve({ success: false })
      }
    )

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
        createdAt: 1,
      },
    })
    mockSendMessage.mockImplementation(
      async (message: { type: string; word?: string }) => {
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
              Chinese: `${message.word}释义`,
              Pronunciation: `/${message.word}/`,
            },
          }
        }
        return { success: false }
      }
    )

    render(<SidePanel />)
    await screen.findByTestId('sidepanel-sentence')

    selectWord('Cats')
    selectWord('great')
    await waitFor(() =>
      expect(screen.getByTestId('sidepanel-card-cats')).toHaveTextContent(
        'cats释义'
      )
    )

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
        createdAt: 1,
      },
    })
    mockSendMessage.mockImplementation(
      async (message: { type: string; word?: string }) => {
        if (message.type === 'translateSentence') {
          return { success: true, chinese: '猫是很棒的宠物。' }
        }
        if (message.type === 'translateWordInContext') {
          return { success: true, chinese: `${message.word}在这句里的意思` }
        }
        if (message.type === 'getOneWord') {
          return {
            success: true,
            ecp: { English: message.word, Chinese: '', Pronunciation: '' },
          }
        }
        return { success: false }
      }
    )

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
    mockSendMessage.mockImplementation(
      async (message: { sentence?: string }) => {
        if (message.sentence === 'First sentence.') {
          return { success: true, chinese: '第一句。' }
        }
        if (message.sentence === 'Second sentence.') {
          return { success: true, chinese: '第二句。' }
        }
        return { success: false }
      }
    )

    render(<SidePanel />)
    await screen.findByTestId('sidepanel-empty-state')

    act(() => {
      fireStorageChange(
        {
          [PENDING_SENTENCE_STORAGE_KEY]: {
            newValue: {
              sentence: 'First sentence.',
              word: '',
              createdAt: 1,
            },
          },
        },
        'session'
      )
    })
    await waitFor(() =>
      expect(screen.getByTestId('sidepanel-chinese')).toHaveTextContent(
        '第一句。'
      )
    )

    act(() => {
      fireStorageChange(
        {
          [PENDING_SENTENCE_STORAGE_KEY]: {
            newValue: {
              sentence: 'Second sentence.',
              word: '',
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

  describe('Clear with undo', () => {
    const lookUpOnPage = (word: string, createdAt: number) =>
      act(() => {
        fireStorageChange(
          {
            [LATEST_PAGE_WORD_STORAGE_KEY]: {
              newValue: {
                word,
                ecp: { English: word, Chinese: `${word}的释义`, LoadCount: 1 },
                createdAt,
              },
            },
          },
          'session'
        )
      })

    afterEach(() => {
      jest.useRealTimers()
    })

    it('empties the list and brings it back on Undo', async () => {
      render(<SidePanel />)
      await screen.findByTestId('sidepanel-empty-state')
      lookUpOnPage('troy', 1)
      await screen.findByTestId('sidepanel-card-troy')

      fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
      expect(
        screen.queryByTestId('sidepanel-card-troy')
      ).not.toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
      expect(screen.getByTestId('sidepanel-card-troy')).toHaveTextContent(
        'troy的释义'
      )
    })

    it('stops offering Undo after a few seconds', async () => {
      render(<SidePanel />)
      await screen.findByTestId('sidepanel-empty-state')
      lookUpOnPage('troy', 1)
      await screen.findByTestId('sidepanel-card-troy')

      jest.useFakeTimers()
      fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
      expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()
      act(() => {
        jest.advanceTimersByTime(6000)
      })
      expect(
        screen.queryByRole('button', { name: 'Undo' })
      ).not.toBeInTheDocument()
    })

    it('drops the Undo offer once a new lookup arrives', async () => {
      render(<SidePanel />)
      await screen.findByTestId('sidepanel-empty-state')
      lookUpOnPage('troy', 1)
      await screen.findByTestId('sidepanel-card-troy')

      fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
      lookUpOnPage('argues', 2)
      await screen.findByTestId('sidepanel-card-argues')
      // Empty again, still within the Undo window: the old list must not
      // come back as an offer.
      fireEvent.click(screen.getByTestId('sidepanel-remove-argues'))

      expect(
        screen.queryByRole('button', { name: 'Undo' })
      ).not.toBeInTheDocument()
      expect(
        screen.queryByTestId('sidepanel-card-troy')
      ).not.toBeInTheDocument()
    })
  })

  it('counts the top-level history items, not the words nested in a sentence', async () => {
    ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({
      [PENDING_SENTENCE_STORAGE_KEY]: {
        sentence: 'Cats are great pets.',
        word: '',
        createdAt: 1,
      },
    })
    mockSendMessage.mockImplementation(
      async (message: { type: string; word?: string }) => {
        if (message.type === 'translateSentence') {
          return { success: true, chinese: '猫是很棒的宠物。' }
        }
        if (message.type === 'translateWordInContext') {
          return { success: true, chinese: '猫' }
        }
        if (message.type === 'getOneWord') {
          return {
            success: true,
            ecp: { English: message.word, Chinese: '猫', LoadCount: 1 },
          }
        }
        return { success: false }
      }
    )

    render(<SidePanel />)
    await screen.findByTestId('sidepanel-sentence')
    selectWord('Cats')
    await screen.findByTestId('sidepanel-card-cats')
    expect(screen.getByText('History · 1')).toBeInTheDocument()

    act(() => {
      fireStorageChange(
        {
          [LATEST_PAGE_WORD_STORAGE_KEY]: {
            newValue: {
              word: 'troy',
              ecp: { English: 'troy', Chinese: '金衡', LoadCount: 1 },
              createdAt: 2,
            },
          },
        },
        'session'
      )
    })
    await screen.findByTestId('sidepanel-card-troy')
    expect(screen.getByText('History · 2')).toBeInTheDocument()
  })

  it('says "1 time", not "1 times", for a word looked up once', async () => {
    render(<SidePanel />)
    await screen.findByTestId('sidepanel-empty-state')

    act(() => {
      fireStorageChange(
        {
          [LATEST_PAGE_WORD_STORAGE_KEY]: {
            newValue: {
              word: 'troy',
              ecp: { English: 'troy', Chinese: '金衡', LoadCount: 1 },
              createdAt: 1,
            },
          },
        },
        'session'
      )
    })

    const card = await screen.findByTestId('sidepanel-card-troy')
    expect(within(card).getByTitle('Looked up 1 time')).toHaveTextContent('1')
  })

  it('keeps the sentence (and its nested in-sentence word) visible when a page word lookup arrives afterwards (ADR-023, fixes the previous "sentence disappears" bug)', async () => {
    ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({
      [PENDING_SENTENCE_STORAGE_KEY]: {
        sentence: 'Cats are great pets.',
        word: '',
        createdAt: 1,
      },
    })
    mockSendMessage.mockImplementation(
      async (message: { type: string; word?: string }) => {
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
              Chinese: `${message.word}释义`,
              Pronunciation: `/${message.word}/`,
            },
          }
        }
        return { success: false }
      }
    )

    render(<SidePanel />)
    await screen.findByTestId('sidepanel-sentence')
    selectWord('great')
    await waitFor(() =>
      expect(screen.getByTestId('sidepanel-sentence-words')).toHaveTextContent(
        'great在这句里的意思'
      )
    )
    await waitFor(() =>
      expect(screen.getByTestId('sidepanel-chinese')).toHaveTextContent(
        '猫是很棒的宠物。'
      )
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
    expect(screen.getByTestId('sidepanel-sentence')).toHaveTextContent(
      'Cats are great pets.'
    )
    expect(screen.getByTestId('sidepanel-chinese')).toHaveTextContent(
      '猫是很棒的宠物。'
    )
    expect(screen.getByTestId('sidepanel-sentence-words')).toHaveTextContent(
      'great在这句里的意思'
    )

    // Newest arrival ('serendipity', a top-level card) renders above the
    // sentence entry (ADR-023 Decision 4: a page click always prepends to
    // the top-level list, never touching any sentence entry).
    const serendipityCard = screen.getByTestId('sidepanel-card-serendipity')
    const sentenceEntry = screen.getByTestId(/^sidepanel-sentence-entry-/)
    expect(
      serendipityCard.compareDocumentPosition(sentenceEntry) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()

    // No re-fetch: the card was populated directly from the storage payload.
    expect(mockSendMessage.mock.calls.length).toBe(callsBeforePageLookup)
  })

  it('keeps an existing page-lookup word card when a sentence translation is triggered afterwards (ADR-006 addendum)', async () => {
    mockSendMessage.mockResolvedValue({
      success: true,
      chinese: '猫是很棒的宠物。',
    })

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
              createdAt: 2,
            },
          },
        },
        'session'
      )
    })

    await waitFor(() =>
      expect(screen.getByTestId('sidepanel-chinese')).toHaveTextContent(
        '猫是很棒的宠物。'
      )
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
    mockSendMessage.mockImplementation(
      async (message: { type: string; word?: string }) => {
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
              Chinese: `${message.word}释义(重新查询)`,
              Pronunciation: `/${message.word}/`,
            },
          }
        }
        return { success: false }
      }
    )

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
              ecp: {
                English: 'cats',
                Chinese: '猫的复数',
                Pronunciation: '/kæts/',
                LoadCount: 2,
              },
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
              createdAt: 2,
            },
          },
        },
        'session'
      )
    })
    await screen.findByTestId('sidepanel-sentence')
    // The page-lookup card is untouched by the new sentence context.
    expect(screen.getByTestId('sidepanel-card-cats')).toHaveTextContent(
      '猫的复数'
    )

    // 3) Clicking "Cats" inside the sentence fetches a fresh, separate card
    //    nested under the sentence -- it does not touch the top-level one.
    //    Both scopes now render a "cats" card, so disambiguate by container
    //    rather than relying on the word testid alone.
    selectWord('Cats')

    await waitFor(() =>
      expect(screen.getByTestId('sidepanel-sentence-words')).toHaveTextContent(
        'cats在这句里的意思'
      )
    )
    const nestedCard = within(
      screen.getByTestId('sidepanel-sentence-words')
    ).getByTestId('sidepanel-card-cats')
    expect(nestedCard).toHaveTextContent('cats在这句里的意思')
    expect(nestedCard).toHaveTextContent('cats释义(重新查询)')

    // The top-level card is untouched -- still the original dictionary text.
    const topLevelCardAfter = screen
      .getAllByTestId('sidepanel-card-cats')
      .find(el => el !== nestedCard)!
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
        createdAt: 1,
      },
    }

    it('does not double-fetch when the anchor word is clicked in the sentence while its own dictionary-first lookup is still in flight (ADR-023 race)', async () => {
      ;(chrome.storage.session.get as jest.Mock).mockResolvedValue(
        pendingWithWord
      )

      let resolveDictionary: (value: BackgroundResponse) => void = () => {}
      let getOneWordCalls = 0
      let contextCalls = 0
      mockSendMessage.mockImplementation(
        (message: { type: string; word?: string }) => {
          if (message.type === 'translateSentence') {
            return Promise.resolve({
              success: true,
              chinese: '猫是很棒的宠物。',
            })
          }
          if (message.type === 'getOneWord') {
            getOneWordCalls += 1
            return new Promise(resolve => {
              resolveDictionary = resolve
            })
          }
          if (message.type === 'translateWordInContext') {
            contextCalls += 1
            return Promise.resolve({ success: true, chinese: 'great语境义' })
          }
          return Promise.resolve({ success: false })
        }
      )

      render(<SidePanel />)
      // The anchor word's own card (and its dictionary-first lookup) is
      // seeded synchronously as soon as the sentence entry is created --
      // before getOneWord resolves -- and the word is highlighted
      // (clickable) in the same render.
      await screen.findByTestId('sidepanel-sentence')
      selectWord('great')

      expect(getOneWordCalls).toBe(1)
      expect(contextCalls).toBe(0)

      resolveDictionary({
        success: true,
        ecp: {
          Key: 'great',
          English: 'great',
          Chinese: 'great词典',
          Pronunciation: '/greɪt/',
          LoadCount: 1,
          Known: false,
          WordType: 0,
        },
      })

      await waitFor(() =>
        expect(
          screen.getByTestId('sidepanel-sentence-words')
        ).toHaveTextContent('great语境义')
      )
      // Still only ever fetched once each -- no double Query Count
      // increment, no double AI charge for the same word, despite the
      // click landing while the dictionary lookup was still in flight.
      expect(getOneWordCalls).toBe(1)
      expect(contextCalls).toBe(1)
    })

    it('sends translateSentence (not translateSentenceWithWord) and looks up the anchor word dictionary-first', async () => {
      ;(chrome.storage.session.get as jest.Mock).mockResolvedValue(
        pendingWithWord
      )
      mockSendMessage.mockImplementation(
        async (message: {
          type: string
          word?: string
          dictionaryChinese?: string
        }) => {
          if (message.type === 'translateSentence') {
            return { success: true, chinese: '猫是很棒的宠物。' }
          }
          if (message.type === 'getOneWord') {
            return {
              success: true,
              ecp: {
                English: message.word,
                Chinese: 'great的词典释义',
                Pronunciation: '/greɪt/',
                LoadCount: 7,
              },
            }
          }
          if (message.type === 'translateWordInContext') {
            return { success: true, chinese: '极好的', why: '' }
          }
          return { success: false }
        }
      )

      render(<SidePanel />)

      await waitFor(() =>
        expect(screen.getByTestId('sidepanel-chinese')).toHaveTextContent(
          '猫是很棒的宠物。'
        )
      )
      // Card for the clicked word is seeded automatically: dictionary first,
      // then the AI call fed that definition.
      await waitFor(() => {
        const card = screen.getByTestId('sidepanel-card-great')
        expect(card).toHaveTextContent('极好的')
        expect(card).toHaveTextContent('great的词典释义')
        expect(card).toHaveTextContent('/greɪt/')
      })
      expect(mockSendMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'translateSentenceWithWord' })
      )
      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'translateWordInContext',
          word: 'great',
          dictionaryChinese: 'great的词典释义',
        })
      )
    })

    // ADR-023 addendum: "click a word on the page, then 整句翻译 from its
    // popover" used to leave two cards for the same word side by side -- the
    // top-level page-lookup card and the sentence's nested anchor card.
    describe('absorbing the page-lookup card just before it', () => {
      const pageLookup = (word: string, chinese: string, createdAt: number) =>
        act(() => {
          fireStorageChange(
            {
              [LATEST_PAGE_WORD_STORAGE_KEY]: {
                newValue: {
                  word,
                  ecp: {
                    English: word,
                    Chinese: chinese,
                    Pronunciation: `/${word}/`,
                    LoadCount: 3,
                  },
                  createdAt,
                },
              },
            },
            'session'
          )
        })

      const openSentenceFrom = (word: string, createdAt: number) =>
        act(() => {
          fireStorageChange(
            {
              [PENDING_SENTENCE_STORAGE_KEY]: {
                newValue: {
                  sentence: SENTENCE,
                  word,
                  createdAt,
                },
              },
            },
            'session'
          )
        })

      beforeEach(() => {
        mockSendMessage.mockImplementation(
          async (message: { type: string; word?: string }) => {
            if (message.type === 'translateSentence') {
              return { success: true, chinese: '猫是很棒的宠物。' }
            }
            if (message.type === 'getOneWord') {
              return {
                success: true,
                ecp: {
                  English: message.word,
                  Chinese: `${message.word}释义(重新查询)`,
                  Pronunciation: `/${message.word}/`,
                },
              }
            }
            if (message.type === 'translateWordInContext') {
              return { success: true, chinese: `${message.word}在这句里的意思` }
            }
            return { success: false }
          }
        )
      })

      it('moves the card into the sentence instead of leaving a duplicate on top', async () => {
        render(<SidePanel />)
        await screen.findByTestId('sidepanel-empty-state')

        pageLookup('great', 'great页面释义', 1)
        await screen.findByTestId('sidepanel-card-great')
        openSentenceFrom('great', 2)

        await waitFor(() =>
          expect(
            screen.getByTestId('sidepanel-sentence-words')
          ).toHaveTextContent('great在这句里的意思')
        )
        const cards = screen.getAllByTestId('sidepanel-card-great')
        expect(cards).toHaveLength(1)
        expect(
          within(screen.getByTestId('sidepanel-sentence-words')).getByTestId(
            'sidepanel-card-great'
          )
        ).toHaveTextContent('great页面释义')
      })

      it('reuses its dictionary data and only fetches the in-sentence meaning', async () => {
        render(<SidePanel />)
        await screen.findByTestId('sidepanel-empty-state')

        pageLookup('great', 'great页面释义', 1)
        await screen.findByTestId('sidepanel-card-great')
        openSentenceFrom('great', 2)

        await waitFor(() =>
          expect(mockSendMessage).toHaveBeenCalledWith(
            expect.objectContaining({
              type: 'translateWordInContext',
              word: 'great',
              sentence: SENTENCE,
              dictionaryChinese: 'great页面释义',
            })
          )
        )
        expect(mockSendMessage).not.toHaveBeenCalledWith(
          expect.objectContaining({ type: 'getOneWord' })
        )
      })

      it('leaves a same-word card alone when another entry sits between them', async () => {
        render(<SidePanel />)
        await screen.findByTestId('sidepanel-empty-state')

        pageLookup('great', 'great页面释义', 1)
        await screen.findByTestId('sidepanel-card-great')
        pageLookup('pets', 'pets页面释义', 2)
        await screen.findByTestId('sidepanel-card-pets')
        openSentenceFrom('great', 3)

        await waitFor(() =>
          expect(
            screen.getByTestId('sidepanel-sentence-words')
          ).toHaveTextContent('great释义(重新查询)')
        )
        expect(screen.getAllByTestId('sidepanel-card-great')).toHaveLength(2)
        expect(screen.getByTestId('sidepanel-card-pets')).toBeInTheDocument()
      })

      it('leaves the card on top when the sentence was opened from a different word', async () => {
        render(<SidePanel />)
        await screen.findByTestId('sidepanel-empty-state')

        pageLookup('cats', 'cats页面释义', 1)
        await screen.findByTestId('sidepanel-card-cats')
        openSentenceFrom('great', 2)

        await waitFor(() =>
          expect(
            screen.getByTestId('sidepanel-sentence-words')
          ).toHaveTextContent('great在这句里的意思')
        )
        expect(screen.getByTestId('sidepanel-card-cats')).toHaveTextContent(
          'cats页面释义'
        )
        expect(
          within(screen.getByTestId('sidepanel-sentence-words')).queryByTestId(
            'sidepanel-card-cats'
          )
        ).not.toBeInTheDocument()
      })
    })

    it('highlights every occurrence of the clicked word in the original', async () => {
      ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({
        [PENDING_SENTENCE_STORAGE_KEY]: {
          sentence: 'A great day for a great walk.',
          word: 'great',
          createdAt: 1,
        },
      })
      mockSendMessage.mockResolvedValue({
        success: true,
        chinese: '译文',
        wordChinese: '极好的',
      })

      render(<SidePanel />)

      const sentence = await screen.findByTestId('sidepanel-sentence')
      expect(highlightTexts('enx-sp-anchor')).toEqual(['great', 'great'])
      // ADR-053 Decision 1: the original stays one plain text node.
      expect(sentence.childNodes).toHaveLength(1)
    })

    // The dictionary lookup is optional context for the AI call, not a
    // precondition: a word with no dictionary entry (or a failed lookup)
    // still gets its contextual meaning, just with no definition to compare
    // against (so `why` naturally comes back empty).
    it('still looks up the context meaning when the anchor word has no dictionary entry', async () => {
      ;(chrome.storage.session.get as jest.Mock).mockResolvedValue(
        pendingWithWord
      )
      mockSendMessage.mockImplementation(
        async (message: {
          type: string
          word?: string
          dictionaryChinese?: string
        }) => {
          if (message.type === 'translateSentence') {
            return { success: true, chinese: '猫是很棒的宠物。' }
          }
          if (message.type === 'getOneWord') {
            return { success: false, error: 'not found' }
          }
          if (message.type === 'translateWordInContext') {
            return { success: true, chinese: '极好的' }
          }
          return { success: false }
        }
      )

      render(<SidePanel />)

      await waitFor(() =>
        expect(screen.getByTestId('sidepanel-card-great')).toHaveTextContent(
          '极好的'
        )
      )
      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'translateWordInContext',
          word: 'great',
          dictionaryChinese: undefined,
        })
      )
    })

    it('does not seed a card or highlight for a drag-selected sentence (no anchor word)', async () => {
      ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({
        [PENDING_SENTENCE_STORAGE_KEY]: {
          sentence: 'Cats are great pets.',
          word: '',
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
        expect(screen.getByTestId('sidepanel-chinese')).toHaveTextContent(
          '猫是很棒的宠物。'
        )
      )
      expect(mockSendMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'translateSentenceWithWord' })
      )
      expect(screen.queryAllByTestId(/^sidepanel-card-/)).toHaveLength(0)
      expect(
        screen.queryByTestId('sidepanel-sentence-words')
      ).not.toBeInTheDocument()
      expect(highlightTexts('enx-sp-anchor')).toEqual([])
    })
  })

  describe('drag-select phrase lookup in the sentence (ADR-017)', () => {
    const seedSentence = async (chinese = '猫是很棒的宠物。') => {
      ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({
        [PENDING_SENTENCE_STORAGE_KEY]: {
          sentence: SENTENCE,
          word: '',
          createdAt: 1,
        },
      })
      mockSendMessage.mockImplementation(async (message: { type: string }) => {
        if (message.type === 'translateSentence')
          return { success: true, chinese }
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

      expect(
        await screen.findByTestId('sidepanel-phrase-confirm')
      ).toBeInTheDocument()
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
      expect(
        within(card).queryByText(/Loading phonetics/)
      ).not.toBeInTheDocument()
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
      expect(
        screen.queryByTestId('sidepanel-phrase-confirm')
      ).not.toBeInTheDocument()
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
        expect(
          screen.queryByTestId('sidepanel-phrase-confirm')
        ).not.toBeInTheDocument()
      )
      expect(mockSendMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'translateWordInContext' })
      )
    })

    it('does not pop the confirm button when the whole sentence is selected', async () => {
      await seedSentence()

      selectWord(SENTENCE)

      await waitFor(() => expect(mockSendMessage).toHaveBeenCalled())
      expect(
        screen.queryByTestId('sidepanel-phrase-confirm')
      ).not.toBeInTheDocument()
    })

    it('re-selecting a phrase already in the list just moves its card up, no new lookup', async () => {
      const user = userEvent.setup()
      await seedSentence()

      selectWord('great pets')
      await user.click(await screen.findByTestId('sidepanel-phrase-confirm'))
      await screen.findByTestId('sidepanel-card-great pets')

      selectWord('great pets')
      await waitFor(() =>
        expect(
          screen.queryByTestId('sidepanel-phrase-confirm')
        ).not.toBeInTheDocument()
      )
      expect(
        mockSendMessage.mock.calls.filter(
          ([m]) => m.type === 'translateWordInContext'
        )
      ).toHaveLength(1)
    })
  })

  describe('unified history list (ADR-023)', () => {
    it('keeps every translated sentence in the panel, newest on top', async () => {
      ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({
        [PENDING_SENTENCE_STORAGE_KEY]: {
          sentence: 'First sentence.',
          word: '',
          createdAt: 1,
        },
      })
      mockSendMessage.mockImplementation(
        async (message: { sentence?: string }) => {
          if (message.sentence === 'First sentence.')
            return { success: true, chinese: '第一句。' }
          if (message.sentence === 'Second sentence.')
            return { success: true, chinese: '第二句。' }
          return { success: false }
        }
      )

      render(<SidePanel />)
      await waitFor(() =>
        expect(screen.getByTestId('sidepanel-chinese')).toHaveTextContent(
          '第一句。'
        )
      )

      act(() => {
        fireStorageChange(
          {
            [PENDING_SENTENCE_STORAGE_KEY]: {
              newValue: {
                sentence: 'Second sentence.',
                word: '',
                createdAt: 2,
              },
            },
          },
          'session'
        )
      })

      await waitFor(() => {
        const sentences = screen.getAllByTestId('sidepanel-sentence')
        expect(sentences.map(s => s.textContent)).toEqual([
          'Second sentence.',
          'First sentence.',
        ])
      })
      await waitFor(() => {
        const chineses = screen.getAllByTestId('sidepanel-chinese')
        expect(chineses.map(c => c.textContent)).toEqual([
          '第二句。',
          '第一句。',
        ])
      })
    })

    it('nests a word looked up inside a historical (non-newest) sentence there, without moving that sentence in the list', async () => {
      ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({
        [PENDING_SENTENCE_STORAGE_KEY]: {
          sentence: 'Cats are great pets.',
          word: '',
          createdAt: 1,
        },
      })
      mockSendMessage.mockImplementation(
        async (message: { type: string; sentence?: string; word?: string }) => {
          if (
            message.type === 'translateSentence' &&
            message.sentence === 'Cats are great pets.'
          ) {
            return { success: true, chinese: '猫是很棒的宠物。' }
          }
          if (
            message.type === 'translateSentence' &&
            message.sentence === 'Dogs are loyal friends.'
          ) {
            return { success: true, chinese: '狗是忠诚的朋友。' }
          }
          if (message.type === 'translateWordInContext') {
            return { success: true, chinese: `${message.word}在这句里的意思` }
          }
          if (message.type === 'getOneWord') {
            return {
              success: true,
              ecp: {
                English: message.word,
                Chinese: `${message.word}释义`,
                Pronunciation: `/${message.word}/`,
              },
            }
          }
          return { success: false }
        }
      )

      render(<SidePanel />)
      await waitFor(() =>
        expect(screen.getByTestId('sidepanel-chinese')).toHaveTextContent(
          '猫是很棒的宠物。'
        )
      )

      act(() => {
        fireStorageChange(
          {
            [PENDING_SENTENCE_STORAGE_KEY]: {
              newValue: {
                sentence: 'Dogs are loyal friends.',
                word: '',
                createdAt: 2,
              },
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
      const historicalSentenceEl =
        screen.getAllByTestId('sidepanel-sentence')[1]
      selectWord('great', 'Cats are great pets.', historicalSentenceEl)

      await waitFor(() => {
        const entryContainers = screen.getAllByTestId(
          /^sidepanel-sentence-entry-/
        )
        expect(
          within(entryContainers[1]).getByTestId('sidepanel-sentence-words')
        ).toHaveTextContent('great在这句里的意思')
      })

      // Order is unchanged -- the sentence clicked into did not jump to the top.
      const sentencesAfter = screen.getAllByTestId('sidepanel-sentence')
      expect(sentencesAfter.map(s => s.textContent)).toEqual([
        'Dogs are loyal friends.',
        'Cats are great pets.',
      ])
      // The newer sentence's own nested list is untouched (still empty).
      const entryContainersAfter = screen.getAllByTestId(
        /^sidepanel-sentence-entry-/
      )
      expect(
        within(entryContainersAfter[0]).queryByTestId(
          'sidepanel-sentence-words'
        )
      ).not.toBeInTheDocument()
    })
  })

  describe('review-stage underlines in the sentence original (ADR-053)', () => {
    const wordState = (english: string, loadCount: number) => ({
      Key: english,
      English: english,
      Pronunciation: '',
      Chinese: '',
      LoadCount: loadCount,
      Known: false,
      WordType: 0,
    })

    const openSentence = (
      wordStates?: Record<string, unknown>,
      sentence = SENTENCE
    ) => {
      ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({
        [PENDING_SENTENCE_STORAGE_KEY]: {
          sentence,
          word: '',
          createdAt: 1,
          wordStates,
        },
      })
    }

    it('underlines the words the page already had looked up', async () => {
      openSentence({ cats: wordState('cats', 1), pets: wordState('pets', 7) })
      mockSendMessage.mockResolvedValue({ success: true, chinese: '译文' })

      render(<SidePanel />)
      await screen.findByTestId('sidepanel-sentence')

      expect(highlightTexts('enx-hl-1')).toEqual(['Cats'])
      expect(highlightTexts('enx-hl-3')).toEqual(['pets'])
    })

    // A click's definition comes without state; its POST brings the count.
    const lookUp = (english: string) => {
      mockSendMessage.mockImplementation(async (message: { type: string }) => {
        if (message.type === 'getOneWord') {
          return {
            success: true,
            ecp: { ...wordState(english, 0), Id: `${english}-id` },
          }
        }
        if (message.type === 'recordWordLookup') {
          return { success: true, queryCount: 1, known: false }
        }
        return { success: true, chinese: '译文' }
      })
    }
    const lookUpGreat = () => lookUp('great')

    it('underlines a word once it is looked up in the sentence', async () => {
      openSentence()
      lookUpGreat()

      render(<SidePanel />)
      await screen.findByTestId('sidepanel-chinese')
      selectWord('great')

      await waitFor(() => expect(highlightTexts('enx-hl-1')).toEqual(['great']))
    })

    it('tells the page to underline a word looked up in the sentence', async () => {
      openSentence()
      lookUpGreat()

      render(<SidePanel />)
      await screen.findByTestId('sidepanel-chinese')
      selectWord('great')

      await waitFor(() =>
        expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(PANEL_TAB_ID, {
          action: 'panelWordLookup',
          word: 'great',
          ecp: { ...wordState('great', 1), Id: 'great-id' },
        })
      )
    })

    it('neither underlines nor tells the page about a phrase lookup', async () => {
      const user = userEvent.setup()
      openSentence()
      lookUpGreat()

      render(<SidePanel />)
      await screen.findByTestId('sidepanel-chinese')
      selectWord('great pets')
      await user.click(await screen.findByTestId('sidepanel-phrase-confirm'))
      await screen.findByTestId('sidepanel-card-great pets')

      expect(highlightTexts('enx-hl-1')).toEqual([])
      expect(chrome.tabs.sendMessage).not.toHaveBeenCalled()
    })

    it('underlines a word the page looked up while the panel is open', async () => {
      openSentence()
      mockSendMessage.mockResolvedValue({ success: true, chinese: '译文' })

      render(<SidePanel />)
      await screen.findByTestId('sidepanel-chinese')
      act(() => {
        fireStorageChange(
          {
            [LATEST_PAGE_WORD_STORAGE_KEY]: {
              newValue: {
                word: 'pets',
                ecp: wordState('pets', 1),
                createdAt: 2,
              },
            },
          },
          'session'
        )
      })

      await waitFor(() => expect(highlightTexts('enx-hl-1')).toEqual(['pets']))
    })

    it('underlines a possessive looked up on the page', async () => {
      openSentence(undefined, 'The cat’s toy is red.')
      mockSendMessage.mockResolvedValue({ success: true, chinese: '译文' })
      render(<SidePanel />)
      await screen.findByTestId('sidepanel-chinese')

      act(() => {
        fireStorageChange(
          {
            [LATEST_PAGE_WORD_STORAGE_KEY]: {
              newValue: {
                word: 'cat’s',
                ecp: wordState('cat', 1),
                createdAt: 2,
              },
            },
          },
          'session'
        )
      })

      await waitFor(() => expect(highlightTexts('enx-hl-1')).toEqual(['cat’s']))
    })

    it('underlines a possessive looked up in the panel', async () => {
      const sentence = 'The cat’s toy is red.'
      openSentence(undefined, sentence)
      lookUp('cat')
      render(<SidePanel />)
      await screen.findByTestId('sidepanel-chinese')
      selectWord('cat’s', sentence)

      await waitFor(() => expect(highlightTexts('enx-hl-1')).toEqual(['cat’s']))
    })

    it('keeps the anchor but drops the underlines when the highlight preference is off', async () => {
      ;(chrome.storage.local.get as jest.Mock).mockResolvedValue({
        [WORD_HIGHLIGHT_KEY]: false,
      })
      ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({
        [PENDING_SENTENCE_STORAGE_KEY]: {
          sentence: SENTENCE,
          word: 'great',
          createdAt: 1,
          wordStates: { cats: wordState('cats', 1) },
        },
      })
      mockSendMessage.mockResolvedValue({ success: true, chinese: '译文' })

      render(<SidePanel />)
      await screen.findByTestId('sidepanel-chinese')

      await waitFor(() =>
        expect(highlightTexts('enx-sp-anchor')).toEqual(['great'])
      )
      expect(highlightTexts('enx-hl-1')).toEqual([])
    })

    it('applies a highlight preference flip without a reload', async () => {
      openSentence({ cats: wordState('cats', 1) })
      mockSendMessage.mockResolvedValue({ success: true, chinese: '译文' })

      render(<SidePanel />)
      await screen.findByTestId('sidepanel-chinese')
      await waitFor(() => expect(highlightTexts('enx-hl-1')).toEqual(['Cats']))

      act(() => {
        fireStorageChange(
          { [WORD_HIGHLIGHT_KEY]: { oldValue: true, newValue: false } },
          'local'
        )
      })

      await waitFor(() => expect(highlightTexts('enx-hl-1')).toEqual([]))
    })

    // ADR-053 optimistic broadcast: the page's markKnown message reaches
    // every extension page; the panel only listens, background alone replies.
    it('drops the underline as soon as the page marks the word known, without replying', async () => {
      openSentence({ cats: wordState('cats', 1) })
      mockSendMessage.mockResolvedValue({ success: true, chinese: '译文' })

      render(<SidePanel />)
      await screen.findByTestId('sidepanel-chinese')
      await waitFor(() => expect(highlightTexts('enx-hl-1')).toEqual(['Cats']))

      const sendResponse = jest.fn()
      let keepsChannelOpen: unknown
      act(() => {
        for (const [listener] of (
          chrome.runtime.onMessage.addListener as jest.Mock
        ).mock.calls) {
          keepsChannelOpen = listener(
            { type: 'markKnown', word: 'Cats' },
            { tab: { id: PANEL_TAB_ID } },
            sendResponse
          )
        }
      })

      await waitFor(() => expect(highlightTexts('enx-hl-1')).toEqual([]))
      expect(sendResponse).not.toHaveBeenCalled()
      expect(keepsChannelOpen).toBeUndefined()
    })

    // ADR-069: word states are keyed like the review list, so a possessive
    // shares its base word's state.
    it("drops a possessive's underline when the page marks it known", async () => {
      openSentence({ cat: wordState('cat', 1) }, 'The cat’s toy is red.')
      mockSendMessage.mockResolvedValue({ success: true, chinese: '译文' })

      render(<SidePanel />)
      await screen.findByTestId('sidepanel-chinese')
      await waitFor(() => expect(highlightTexts('enx-hl-1')).toEqual(['cat’s']))

      act(() => {
        for (const [listener] of (
          chrome.runtime.onMessage.addListener as jest.Mock
        ).mock.calls) {
          listener(
            { type: 'markKnown', word: 'cat’s' },
            { tab: { id: PANEL_TAB_ID } },
            jest.fn()
          )
        }
      })

      await waitFor(() => expect(highlightTexts('enx-hl-1')).toEqual([]))
    })
  })

  // ADR-023 Decision 8 (#589): one card per sentence, one phrase card per
  // scope and context; responses land by card key and request token.
  describe('one card per sentence or phrase (ADR-023 Decision 8)', () => {
    const OTHER = 'Dogs are great pets.'
    type Message = { type: string; word?: string; sentence?: string }
    type Pending = {
      message: Message
      resolve: (response: BackgroundResponse) => void
      reject: (error: unknown) => void
    }
    let createdAt = 100
    let pending: Pending[]

    const send = (context: {
      sentence: string
      word?: string
      phrase?: string
    }) =>
      act(() => {
        fireStorageChange(
          {
            [PENDING_SENTENCE_STORAGE_KEY]: {
              newValue: { word: '', ...context, createdAt: ++createdAt },
            },
          },
          'session'
        )
      })

    const pageClick = (word: string, chinese: string) =>
      act(() => {
        fireStorageChange(
          {
            [LATEST_PAGE_WORD_STORAGE_KEY]: {
              newValue: {
                word,
                ecp: { English: word, Chinese: chinese, LoadCount: 1 },
                createdAt: ++createdAt,
              },
            },
          },
          'session'
        )
      })

    const replyAtOnce = () =>
      mockSendMessage.mockImplementation(async (message: Message) => {
        if (message.type === 'translateSentence')
          return { success: true, chinese: `${message.sentence}译` }
        if (message.type === 'getOneWord')
          return {
            success: true,
            ecp: { English: message.word, Chinese: `${message.word}词典` },
          }
        if (message.type === 'translateWordInContext')
          return { success: true, chinese: `${message.word}本句` }
        return { success: true }
      })

    const deferAll = () =>
      mockSendMessage.mockImplementation(
        (message: Message) =>
          new Promise((resolve, reject) =>
            pending.push({ message, resolve, reject })
          )
      )

    const take = (type: string, word?: string) => {
      const index = pending.findIndex(
        p => p.message.type === type && (!word || p.message.word === word)
      )
      if (index === -1) throw new Error(`no pending ${type} ${word ?? ''}`)
      return pending.splice(index, 1)[0]
    }

    const settle = (p: Pending, response: BackgroundResponse) =>
      act(async () => p.resolve(response))

    const callsOf = (type: string, word?: string) =>
      mockSendMessage.mock.calls.filter(
        ([m]) => m.type === type && (!word || m.word === word)
      ).length

    const sentenceTexts = () =>
      screen.queryAllByTestId('sidepanel-sentence').map(el => el.textContent)

    const nestedWords = () =>
      within(screen.getByTestId('sidepanel-sentence-words'))
        .getAllByTestId(/^sidepanel-card-/)
        .map(el => el.getAttribute('data-testid'))

    beforeEach(() => {
      pending = []
    })

    const renderEmpty = async () => {
      render(<SidePanel />)
      await screen.findByTestId('sidepanel-empty-state')
    }

    it('expands the same word independently in different sentence scopes', async () => {
      replyAtOnce()
      mockSendMessage.mockImplementation(async (message: Message) => {
        if (message.type === 'getOneWord')
          return {
            success: true,
            ecp: {
              English: message.word,
              Chinese: 'A long dictionary definition '.repeat(3),
            },
          }
        if (message.type === 'translateSentence')
          return { success: true, chinese: `${message.sentence}译` }
        return { success: true, chinese: `${message.word}本句` }
      })
      await renderEmpty()
      send({ sentence: SENTENCE, word: 'great' })
      send({ sentence: OTHER, word: 'great' })

      const toggles = await screen.findAllByTestId(
        'sidepanel-toggle-meaning-great'
      )
      expect(toggles).toHaveLength(2)
      expect(toggles[0]).toHaveTextContent('Expand')
      expect(toggles[1]).toHaveTextContent('Expand')

      fireEvent.click(toggles[0])

      expect(toggles[0]).toHaveTextContent('Collapse')
      expect(toggles[1]).toHaveTextContent('Expand')
    })

    it('moves a re-sent sentence to the top instead of adding a second card', async () => {
      replyAtOnce()
      await renderEmpty()
      send({ sentence: SENTENCE })
      await screen.findByText(`${SENTENCE}译`)
      send({ sentence: OTHER })
      await screen.findByText(`${OTHER}译`)

      send({ sentence: SENTENCE })

      await waitFor(() => expect(sentenceTexts()).toEqual([SENTENCE, OTHER]))
      expect(screen.getByText('History · 2')).toBeInTheDocument()
      expect(screen.getAllByText(`${SENTENCE}译`)).toHaveLength(1)
      expect(callsOf('translateSentence')).toBe(2)
    })

    it('sends no second translation for a sentence still loading, and the first one lands', async () => {
      deferAll()
      await renderEmpty()
      send({ sentence: SENTENCE })
      send({ sentence: SENTENCE })

      expect(callsOf('translateSentence')).toBe(1)
      await settle(take('translateSentence'), {
        success: true,
        chinese: '猫是很棒的宠物。',
      })
      expect(screen.getByTestId('sidepanel-chinese')).toHaveTextContent(
        '猫是很棒的宠物。'
      )
      expect(sentenceTexts()).toEqual([SENTENCE])
    })

    it('treats sentences that differ only in whitespace or case as one', async () => {
      replyAtOnce()
      await renderEmpty()
      send({ sentence: 'Cats are  great.' })
      send({ sentence: 'cats are great. ' })
      await waitFor(() => expect(sentenceTexts()).toEqual(['Cats are  great.']))

      send({ sentence: OTHER })
      await waitFor(() =>
        expect(sentenceTexts()).toEqual([OTHER, 'Cats are  great.'])
      )
    })

    it('keeps the nested cards and highlights the new anchor when re-sent from another word', async () => {
      replyAtOnce()
      await renderEmpty()
      send({ sentence: SENTENCE, word: 'cats' })
      await screen.findByText('cats本句')

      send({ sentence: SENTENCE, word: 'great' })

      await screen.findByText('great本句')
      expect(nestedWords()).toEqual([
        'sidepanel-card-great',
        'sidepanel-card-cats',
      ])
      expect(highlightTexts('enx-sp-anchor')).toEqual(['great'])
    })

    it('reuses a loaded nested card for the anchor word and drops the page card for it', async () => {
      replyAtOnce()
      await renderEmpty()
      send({ sentence: SENTENCE, word: 'great' })
      await screen.findByText('great本句')
      selectWord('cats')
      await screen.findByText('cats本句')
      pageClick('great', 'great页面释义')
      await screen.findByText('great页面释义')

      send({ sentence: SENTENCE, word: 'great' })

      await waitFor(() =>
        expect(screen.queryByText('great页面释义')).not.toBeInTheDocument()
      )
      expect(nestedWords()).toEqual([
        'sidepanel-card-great',
        'sidepanel-card-cats',
      ])
      expect(screen.getAllByTestId('sidepanel-card-great')).toHaveLength(1)
      expect(callsOf('getOneWord', 'great')).toBe(1)
      expect(callsOf('translateWordInContext', 'great')).toBe(1)
    })

    it('reuses a loading nested card for the anchor word, which still gets its result', async () => {
      deferAll()
      await renderEmpty()
      send({ sentence: SENTENCE, word: 'great' })
      selectWord('cats')
      pageClick('great', 'great页面释义')
      await screen.findByText('great页面释义')

      send({ sentence: SENTENCE, word: 'great' })

      await waitFor(() =>
        expect(screen.queryByText('great页面释义')).not.toBeInTheDocument()
      )
      expect(nestedWords()).toEqual([
        'sidepanel-card-great',
        'sidepanel-card-cats',
      ])
      expect(callsOf('getOneWord', 'great')).toBe(1)
      await settle(take('getOneWord', 'great'), {
        success: true,
        ecp: { English: 'great', Chinese: 'great词典' } as never,
      })
      await settle(take('translateWordInContext', 'great'), {
        success: true,
        chinese: 'great本句',
      })
      expect(screen.getByTestId('sidepanel-card-great')).toHaveTextContent(
        'great本句'
      )
      expect(callsOf('translateWordInContext', 'great')).toBe(1)
    })

    it('absorbs the adjacent page card when re-sent from a word with no nested card', async () => {
      replyAtOnce()
      await renderEmpty()
      send({ sentence: SENTENCE })
      await screen.findByText(`${SENTENCE}译`)
      pageClick('great', 'great页面释义')
      await screen.findByText('great页面释义')

      send({ sentence: SENTENCE, word: 'great' })

      await screen.findByText('great本句')
      expect(sentenceTexts()).toEqual([SENTENCE])
      expect(
        within(screen.getByTestId('sidepanel-sentence-words')).getByTestId(
          'sidepanel-card-great'
        )
      ).toHaveTextContent('great页面释义')
      expect(screen.getAllByTestId('sidepanel-card-great')).toHaveLength(1)
      expect(callsOf('getOneWord')).toBe(0)
      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'translateWordInContext',
          word: 'great',
          dictionaryChinese: 'great页面释义',
        })
      )
    })

    it('retries a sentence card in the error state when it is sent again', async () => {
      deferAll()
      await renderEmpty()
      send({ sentence: SENTENCE })
      await settle(take('translateSentence'), { success: false, error: 'down' })
      await screen.findByTestId('sidepanel-error')

      send({ sentence: SENTENCE })

      expect(sentenceTexts()).toEqual([SENTENCE])
      expect(callsOf('translateSentence')).toBe(2)
      await settle(take('translateSentence'), {
        success: true,
        chinese: '猫是很棒的宠物。',
      })
      expect(screen.getByTestId('sidepanel-chinese')).toHaveTextContent(
        '猫是很棒的宠物。'
      )
    })

    it('restores a sentence response received between Clear and Undo', async () => {
      deferAll()
      await renderEmpty()
      send({ sentence: SENTENCE })
      fireEvent.click(screen.getByTestId('sidepanel-clear-all'))

      await settle(take('translateSentence'), {
        success: true,
        chinese: '恢复译文',
      })
      expect(screen.getByTestId('sidepanel-empty-state')).toBeInTheDocument()
      fireEvent.click(screen.getByTestId('sidepanel-undo-clear'))

      expect(screen.getByTestId('sidepanel-chinese')).toHaveTextContent(
        '恢复译文'
      )
      expect(callsOf('translateSentence')).toBe(1)
    })

    it('restores a phrase response received between Clear and Undo', async () => {
      deferAll()
      await renderEmpty()
      send({ sentence: SENTENCE, phrase: 'great pets' })
      fireEvent.click(screen.getByTestId('sidepanel-clear-all'))
      await settle(take('translateWordInContext'), {
        success: true,
        chinese: '短语译文',
      })
      fireEvent.click(screen.getByTestId('sidepanel-undo-clear'))

      expect(screen.getByTestId('sidepanel-card-great pets')).toHaveTextContent(
        '短语译文'
      )
      expect(callsOf('translateWordInContext')).toBe(1)
    })

    it('pauses a cleared dictionary-first lookup and resumes it once on Undo', async () => {
      deferAll()
      await renderEmpty()
      send({ sentence: SENTENCE })
      selectWord('great')
      fireEvent.click(screen.getByTestId('sidepanel-clear-all'))
      await settle(take('getOneWord'), {
        success: true,
        ecp: {
          Id: 'great-id',
          English: 'great',
          Chinese: '词典释义',
          LoadCount: 2,
        } as never,
      })
      expect(callsOf('translateWordInContext')).toBe(0)
      fireEvent.click(screen.getByTestId('sidepanel-undo-clear'))
      await act(async () => {})

      expect(screen.getByTestId('sidepanel-card-great')).toHaveTextContent(
        '词典释义'
      )
      expect(callsOf('getOneWord')).toBe(1)
      expect(callsOf('recordWordLookup')).toBe(1)
      expect(callsOf('translateWordInContext')).toBe(1)
      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'translateWordInContext',
          dictionaryChinese: '词典释义',
        })
      )
      await settle(take('translateWordInContext'), {
        success: true,
        chinese: '语境释义',
      })
      expect(screen.getByTestId('sidepanel-card-great')).toHaveTextContent(
        '语境释义'
      )
    })

    describe('Clear and Undo request lifetime', () => {
      const clear = () =>
        fireEvent.click(screen.getByTestId('sidepanel-clear-all'))
      const undo = () =>
        fireEvent.click(screen.getByTestId('sidepanel-undo-clear'))
      afterEach(() => jest.useRealTimers())

      it('receives a sentence response arriving after Undo without another request', async () => {
        deferAll()
        await renderEmpty()
        send({ sentence: SENTENCE })
        clear()
        undo()
        await settle(take('translateSentence'), {
          success: true,
          chinese: '后到译文',
        })
        expect(screen.getByTestId('sidepanel-chinese')).toHaveTextContent(
          '后到译文'
        )
        expect(callsOf('translateSentence')).toBe(1)
      })

      it.each(['response', 'rejection'] as const)(
        'restores a sentence %s error and permits explicit Retry',
        async failure => {
          deferAll()
          await renderEmpty()
          send({ sentence: SENTENCE })
          clear()
          const request = take('translateSentence')
          if (failure === 'response')
            await settle(request, { success: false, error: 'Service down' })
          else await act(async () => request.reject(new Error('offline')))
          undo()
          expect(screen.getByTestId('sidepanel-error')).toBeInTheDocument()
          expect(callsOf('translateSentence')).toBe(1)
          fireEvent.click(screen.getByTestId('sidepanel-retry-sentence'))
          await settle(take('translateSentence'), {
            success: true,
            chinese: '重试译文',
          })
          expect(screen.getByTestId('sidepanel-chinese')).toHaveTextContent(
            '重试译文'
          )
          expect(callsOf('translateSentence')).toBe(2)
        }
      )

      it.each(['word', 'phrase'] as const)(
        'restores an already-issued %s context response without repeating it',
        async kind => {
          deferAll()
          await renderEmpty()
          if (kind === 'word') {
            send({ sentence: SENTENCE, word: 'great' })
            await settle(take('getOneWord'), {
              success: true,
              ecp: { English: 'great', Chinese: '词典释义' } as never,
            })
          } else send({ sentence: SENTENCE, phrase: 'great pets' })
          clear()
          await settle(take('translateWordInContext'), {
            success: true,
            chinese: '原语境结果',
          })
          undo()
          expect(
            screen.getByTestId(
              `sidepanel-card-${kind === 'word' ? 'great' : 'great pets'}`
            )
          ).toHaveTextContent('原语境结果')
          expect(callsOf('translateWordInContext')).toBe(1)
        }
      )

      it.each(['before', 'after'] as const)(
        'receives a phrase result %s Undo in a sentence scope',
        async timing => {
          deferAll()
          await renderEmpty()
          send({ sentence: SENTENCE })
          selectWord('great pets')
          fireEvent.click(screen.getByTestId('sidepanel-phrase-confirm'))
          clear()
          if (timing === 'after') undo()
          await settle(take('translateWordInContext'), {
            success: true,
            chinese: '嵌套短语',
          })
          if (timing === 'before') undo()
          expect(
            within(screen.getByTestId('sidepanel-sentence-words')).getByTestId(
              'sidepanel-card-great pets'
            )
          ).toHaveTextContent('嵌套短语')
          expect(callsOf('translateWordInContext')).toBe(1)
        }
      )

      it('continues a dictionary response arriving after Undo exactly once', async () => {
        deferAll()
        await renderEmpty()
        send({ sentence: SENTENCE })
        selectWord('great')
        clear()
        undo()
        await settle(take('getOneWord'), {
          success: true,
          ecp: {
            Id: 'great-id',
            English: 'great',
            Chinese: '词典释义',
          } as never,
        })
        expect(screen.getByTestId('sidepanel-card-great')).toHaveTextContent(
          '词典释义'
        )
        expect(callsOf('getOneWord')).toBe(1)
        expect(callsOf('recordWordLookup')).toBe(1)
        expect(callsOf('translateWordInContext')).toBe(1)
        await settle(take('translateWordInContext'), {
          success: true,
          chinese: '恢复语境',
        })
        expect(screen.getByTestId('sidepanel-card-great')).toHaveTextContent(
          '恢复语境'
        )
      })

      it.each(['response', 'rejection'] as const)(
        'retains a dictionary %s error and resumes its context only on Undo',
        async failure => {
          deferAll()
          await renderEmpty()
          send({ sentence: SENTENCE, word: 'great' })
          clear()
          const request = take('getOneWord')
          if (failure === 'response')
            await settle(request, { success: false, error: 'Dictionary down' })
          else await act(async () => request.reject(new Error('offline')))
          expect(callsOf('translateWordInContext')).toBe(0)
          undo()
          await act(async () => {})
          expect(
            screen.getByTestId('sidepanel-dictionary-error-great')
          ).toBeInTheDocument()
          expect(callsOf('getOneWord')).toBe(1)
          expect(callsOf('translateWordInContext')).toBe(1)
          await settle(take('translateWordInContext'), {
            success: true,
            chinese: '仍有语境',
          })
          expect(screen.getByTestId('sidepanel-card-great')).toHaveTextContent(
            '仍有语境'
          )
        }
      )

      it.each(['response', 'rejection'] as const)(
        'restores a context %s error with Retry and reuses the dictionary',
        async failure => {
          deferAll()
          await renderEmpty()
          send({ sentence: SENTENCE, word: 'great' })
          await settle(take('getOneWord'), {
            success: true,
            ecp: { English: 'great', Chinese: '词典释义' } as never,
          })
          clear()
          const request = take('translateWordInContext')
          if (failure === 'response')
            await settle(request, { success: false, error: 'AI down' })
          else await act(async () => request.reject(new Error('offline')))
          undo()
          expect(
            screen.getByTestId('sidepanel-context-error-great')
          ).toBeInTheDocument()
          expect(callsOf('translateWordInContext')).toBe(1)
          fireEvent.click(screen.getByTestId('sidepanel-retry-context-great'))
          await settle(take('translateWordInContext'), {
            success: true,
            chinese: '重试语境',
          })
          expect(screen.getByTestId('sidepanel-card-great')).toHaveTextContent(
            '重试语境'
          )
          expect(callsOf('getOneWord')).toBe(1)
          expect(callsOf('translateWordInContext')).toBe(2)
        }
      )

      it.each(['expiry', 'new lookup'] as const)(
        'discards a paused dictionary chain on %s',
        async reason => {
          deferAll()
          await renderEmpty()
          send({ sentence: SENTENCE, word: 'great' })
          jest.useFakeTimers()
          clear()
          await settle(take('getOneWord'), {
            success: true,
            ecp: {
              Id: 'great-id',
              English: 'great',
              Chinese: '旧词典',
            } as never,
          })
          if (reason === 'expiry') act(() => jest.advanceTimersByTime(5000))
          else send({ sentence: OTHER })
          await act(async () => {})
          await settle(take('translateSentence'), {
            success: true,
            chinese: '旧句子',
          })
          expect(
            screen.queryByTestId('sidepanel-undo-clear')
          ).not.toBeInTheDocument()
          expect(
            screen.queryByTestId('sidepanel-card-great')
          ).not.toBeInTheDocument()
          expect(screen.queryByText('旧句子')).not.toBeInTheDocument()
          expect(callsOf('translateWordInContext')).toBe(0)
          expect(callsOf('recordWordLookup')).toBe(0)
        }
      )

      it('keeps a resumed definition and still runs the context call when recording throws', async () => {
        deferAll()
        const deferred = mockSendMessage.getMockImplementation()!
        mockSendMessage.mockImplementation((message: Message) => {
          if (message.type === 'recordWordLookup')
            throw new Error('runtime unavailable')
          return deferred(message)
        })
        await renderEmpty()
        send({ sentence: SENTENCE })
        selectWord('great')
        clear()
        await settle(take('getOneWord'), {
          success: true,
          ecp: {
            Id: 'great-id',
            English: 'great',
            Chinese: '词典释义',
          } as never,
        })
        undo()
        await act(async () => {})
        expect(screen.getByTestId('sidepanel-card-great')).toHaveTextContent(
          '词典释义'
        )
        expect(
          screen.queryByTestId('sidepanel-dictionary-error-great')
        ).not.toBeInTheDocument()
        expect(callsOf('translateWordInContext')).toBe(1)
      })

      it('does not renew the Undo deadline when a hidden response arrives', async () => {
        deferAll()
        await renderEmpty()
        send({ sentence: SENTENCE })
        jest.useFakeTimers()
        clear()
        act(() => jest.advanceTimersByTime(4000))
        await settle(take('translateSentence'), {
          success: true,
          chinese: '旧译文',
        })
        expect(screen.getByTestId('sidepanel-undo-clear')).toBeInTheDocument()
        act(() => jest.advanceTimersByTime(1000))
        expect(
          screen.queryByTestId('sidepanel-undo-clear')
        ).not.toBeInTheDocument()
        expect(screen.queryByText('旧译文')).not.toBeInTheDocument()
      })

      it('preserves multiple pending cards across repeated Clear and Undo', async () => {
        deferAll()
        await renderEmpty()
        send({ sentence: SENTENCE, word: 'great' })
        send({ sentence: OTHER, word: 'great' })
        clear()
        await settle(take('getOneWord'), {
          success: true,
          ecp: { English: 'great', Chinese: '第一词典' } as never,
        })
        undo()
        await act(async () => {})
        clear()
        await settle(take('getOneWord'), {
          success: true,
          ecp: { English: 'great', Chinese: '第二词典' } as never,
        })
        await settle(take('translateWordInContext'), {
          success: true,
          chinese: '第一语境',
        })
        await settle(take('translateSentence'), {
          success: true,
          chinese: '第一句译文',
        })
        undo()
        await act(async () => {})
        await settle(take('translateWordInContext'), {
          success: true,
          chinese: '第二语境',
        })
        await settle(take('translateSentence'), {
          success: true,
          chinese: '第二句译文',
        })
        const blocks = screen
          .getAllByTestId('sidepanel-sentence')
          .map(el => el.parentElement!.parentElement!)
        expect(blocks[0]).toHaveTextContent('第二句译文')
        expect(blocks[0]).toHaveTextContent('第二词典')
        expect(blocks[0]).toHaveTextContent('第二语境')
        expect(blocks[1]).toHaveTextContent('第一句译文')
        expect(blocks[1]).toHaveTextContent('第一词典')
        expect(blocks[1]).toHaveTextContent('第一语境')
        expect(callsOf('getOneWord')).toBe(2)
        expect(callsOf('translateWordInContext')).toBe(2)
      })
    })

    it('keeps the new translation when the one from before Clear fails later', async () => {
      deferAll()
      await renderEmpty()
      send({ sentence: SENTENCE })
      const before = take('translateSentence')
      fireEvent.click(screen.getByTestId('sidepanel-clear-all'))
      send({ sentence: SENTENCE })

      await settle(take('translateSentence'), { success: true, chinese: '新' })
      await act(async () => before.reject(new Error('offline')))

      expect(screen.getByTestId('sidepanel-chinese')).toHaveTextContent('新')
      expect(screen.queryByTestId('sidepanel-error')).not.toBeInTheDocument()
    })

    it('ignores a translation from before Clear that lands while the new one is pending', async () => {
      deferAll()
      await renderEmpty()
      send({ sentence: SENTENCE })
      const before = take('translateSentence')
      fireEvent.click(screen.getByTestId('sidepanel-clear-all'))
      send({ sentence: SENTENCE })

      await settle(before, { success: true, chinese: '旧' })
      expect(screen.getByTestId('sidepanel-loading')).toBeInTheDocument()
      await settle(take('translateSentence'), { success: true, chinese: '新' })
      expect(screen.getByTestId('sidepanel-chinese')).toHaveTextContent('新')
    })

    describe('a dictionary lookup outlived by its card', () => {
      const oldDictionary = { English: 'great', Chinese: '旧词典' } as never

      const expectNewChainOnly = async () => {
        const card = screen.getByTestId('sidepanel-card-great')
        expect(callsOf('translateWordInContext')).toBe(0)
        expect(card).toHaveTextContent('Loading dictionary definition...')
        await settle(take('getOneWord'), {
          success: true,
          ecp: { English: 'great', Chinese: '新词典' } as never,
        })
        await settle(take('translateWordInContext'), {
          success: true,
          chinese: '新本句',
        })
        expect(card).toHaveTextContent('新词典')
        expect(card).toHaveTextContent('新本句')
        expect(callsOf('translateWordInContext')).toBe(1)
      }

      it('writes nothing and starts no context request after remove and reselect', async () => {
        deferAll()
        await renderEmpty()
        send({ sentence: SENTENCE })
        selectWord('great')
        const old = take('getOneWord')
        fireEvent.click(screen.getByTestId('sidepanel-remove-great'))
        selectWord('great')

        await settle(old, { success: true, ecp: oldDictionary })

        await expectNewChainOnly()
      })

      it('writes nothing and starts no context request after Clear and re-send', async () => {
        deferAll()
        await renderEmpty()
        send({ sentence: SENTENCE, word: 'great' })
        const old = take('getOneWord')
        fireEvent.click(screen.getByTestId('sidepanel-clear-all'))
        send({ sentence: SENTENCE, word: 'great' })

        await settle(old, { success: true, ecp: oldDictionary })

        await expectNewChainOnly()
      })

      it('starts no context request after the card is removed', async () => {
        deferAll()
        await renderEmpty()
        send({ sentence: SENTENCE })
        selectWord('great')
        const old = take('getOneWord')
        fireEvent.click(screen.getByTestId('sidepanel-remove-great'))

        await settle(old, { success: true, ecp: oldDictionary })

        expect(callsOf('translateWordInContext')).toBe(0)
      })
    })

    describe('phrases', () => {
      const PHRASE_CARD = 'sidepanel-card-great pets'

      const topLevelCards = () =>
        screen
          .getAllByTestId(/^sidepanel-card-/)
          .filter(el => !el.closest('[data-testid="sidepanel-sentence-words"]'))
          .map(el => el.getAttribute('data-testid'))

      const confirmPhraseIn = async (sentence: string, el?: HTMLElement) => {
        selectWord('great pets', sentence, el)
        fireEvent.click(await screen.findByTestId('sidepanel-phrase-confirm'))
      }

      it('reuses a page phrase card for the same phrase in the same sentence, whatever its case or spacing', async () => {
        replyAtOnce()
        await renderEmpty()
        send({ sentence: SENTENCE, phrase: 'great pets' })
        await screen.findByText('great pets本句')
        pageClick('cats', 'cats页面释义')
        await screen.findByText('cats页面释义')

        send({ sentence: ` ${SENTENCE.toLowerCase()}`, phrase: 'Great  pets' })

        await waitFor(() =>
          expect(topLevelCards()).toEqual([PHRASE_CARD, 'sidepanel-card-cats'])
        )
        expect(callsOf('translateWordInContext')).toBe(1)
      })

      it('moves an in-panel phrase card to the top of its sentence without reordering the list', async () => {
        replyAtOnce()
        await renderEmpty()
        send({ sentence: SENTENCE })
        send({ sentence: OTHER })
        const older = () => screen.getAllByTestId('sidepanel-sentence')[1]
        await confirmPhraseIn(SENTENCE, older())
        await screen.findByText('great pets本句')
        selectWord('cats', SENTENCE, older())
        await screen.findByText('cats本句')

        selectWord('great pets', SENTENCE, older())

        await waitFor(() =>
          expect(nestedWords()).toEqual([PHRASE_CARD, 'sidepanel-card-cats'])
        )
        expect(sentenceTexts()).toEqual([OTHER, SENTENCE])
        expect(callsOf('translateWordInContext', 'great pets')).toBe(1)
      })

      it('gives a phrase its own card and lookup in every other scope', async () => {
        replyAtOnce()
        await renderEmpty()
        send({ sentence: SENTENCE })
        send({ sentence: OTHER })
        await confirmPhraseIn(
          OTHER,
          screen.getAllByTestId('sidepanel-sentence')[0]
        )
        await confirmPhraseIn(
          SENTENCE,
          screen.getAllByTestId('sidepanel-sentence')[1]
        )
        send({ sentence: SENTENCE, phrase: 'great pets' })

        await waitFor(() =>
          expect(screen.getAllByText('great pets本句')).toHaveLength(3)
        )
        expect(callsOf('translateWordInContext', 'great pets')).toBe(3)
      })

      it('keeps one top-level card per context sentence for the same phrase', async () => {
        deferAll()
        await renderEmpty()
        send({ sentence: SENTENCE, phrase: 'great pets' })
        send({ sentence: OTHER, phrase: 'great pets' })
        const fromCats = take('translateWordInContext')
        const fromDogs = take('translateWordInContext')
        await settle(fromDogs, { success: true, chinese: '狗的好宠物' })
        await settle(fromCats, { success: false, error: 'down' })

        const [dogsCard, catsCard] = screen.getAllByTestId(PHRASE_CARD)
        expect(dogsCard).toHaveTextContent('狗的好宠物')
        expect(catsCard).toHaveTextContent('down')

        fireEvent.click(
          within(catsCard).getByTestId('sidepanel-retry-context-great pets')
        )
        expect(take('translateWordInContext').message.sentence).toBe(SENTENCE)
        expect(catsCard).toHaveTextContent('Translating...')
        expect(dogsCard).toHaveTextContent('狗的好宠物')

        fireEvent.click(
          within(catsCard).getByTestId('sidepanel-remove-great pets')
        )
        expect(screen.getAllByTestId(PHRASE_CARD)).toEqual([dogsCard])
      })

      it('retries a failed phrase card when the phrase is selected again', async () => {
        deferAll()
        await renderEmpty()
        send({ sentence: SENTENCE, phrase: 'great pets' })
        await settle(take('translateWordInContext'), {
          success: false,
          error: 'down',
        })

        send({ sentence: SENTENCE, phrase: 'great pets' })

        expect(callsOf('translateWordInContext')).toBe(2)
        await settle(take('translateWordInContext'), {
          success: true,
          chinese: '好宠物',
        })
        expect(screen.getByTestId(PHRASE_CARD)).toHaveTextContent('好宠物')
      })

      it('lets a loading phrase card selected again receive its result', async () => {
        deferAll()
        await renderEmpty()
        send({ sentence: SENTENCE, phrase: 'great pets' })
        pageClick('cats', 'cats页面释义')

        send({ sentence: SENTENCE, phrase: 'great pets' })

        expect(topLevelCards()).toEqual([PHRASE_CARD, 'sidepanel-card-cats'])
        await settle(take('translateWordInContext'), {
          success: true,
          chinese: '好宠物',
        })
        expect(screen.getByTestId(PHRASE_CARD)).toHaveTextContent('好宠物')
        expect(callsOf('translateWordInContext')).toBe(1)
      })
    })
  })

  describe('a page word mirrored again (ADR-006)', () => {
    let createdAt = 0

    const mirror = (word: string, ecp: Record<string, unknown>) =>
      act(() => {
        fireStorageChange(
          {
            [LATEST_PAGE_WORD_STORAGE_KEY]: {
              newValue: {
                word,
                ecp: { English: word, ...ecp },
                createdAt: ++createdAt,
              },
            },
          },
          'session'
        )
      })

    it('shows the AI definition the popover mirrors after a dictionary miss', async () => {
      render(<SidePanel />)
      await screen.findByTestId('sidepanel-empty-state')

      mirror('glimmerous', { Chinese: '', LoadCount: 1 })
      await screen.findByTestId('sidepanel-card-glimmerous')
      mirror('glimmerous', {
        Chinese: '闪烁微光的',
        LoadCount: 1,
        AIFallback: true,
      })

      expect(screen.getAllByTestId('sidepanel-card-glimmerous')).toHaveLength(1)
      expect(screen.getByTestId('sidepanel-card-glimmerous')).toHaveTextContent(
        '闪烁微光的'
      )
    })

    it('moves a word clicked again to the top with its new lookup count', async () => {
      render(<SidePanel />)
      await screen.findByTestId('sidepanel-empty-state')

      mirror('troy', { Chinese: '金衡', LoadCount: 1 })
      mirror('cats', { Chinese: '猫', LoadCount: 1 })
      mirror('troy', { Chinese: '金衡', LoadCount: 2 })

      expect(
        screen.getAllByTestId(/^sidepanel-card-/).map(c => c.dataset.testid)
      ).toEqual(['sidepanel-card-troy', 'sidepanel-card-cats'])
      expect(
        within(screen.getByTestId('sidepanel-card-troy')).getByTitle(
          'Looked up 2 times'
        )
      ).toHaveTextContent('2')
    })
  })
})
