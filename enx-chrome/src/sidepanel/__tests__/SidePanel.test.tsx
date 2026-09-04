import { act, render, screen, waitFor, within } from '@testing-library/react'
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
      error: '积分不足，请充值或订阅',
      status: 402,
    })

    render(<SidePanel />)

    const errorBox = await screen.findByTestId('sidepanel-error')
    expect(errorBox).toHaveTextContent('AI 翻译积分不足')
    const link = within(errorBox).getByText('前往订阅 / 充值')
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
        return { success: false, error: '积分不足，请充值或订阅', status: 402 }
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
    await user.click(screen.getByText('great'))

    const errorRow = await screen.findByTestId('sidepanel-context-error-great')
    expect(errorRow).toHaveTextContent('AI 翻译积分不足')
    expect(within(errorRow).getByText('前往订阅 / 充值')).toHaveAttribute(
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

    const user = userEvent.setup()
    render(<SidePanel />)
    await screen.findByTestId('sidepanel-sentence')
    await user.click(screen.getByText('great'))

    const errorRow = await screen.findByTestId('sidepanel-dictionary-error-great')
    expect(errorRow).toHaveTextContent('今日免费查词次数已用完')
    expect(errorRow).not.toHaveTextContent('Upgrade to enx Pro')
    expect(within(errorRow).getByText('前往订阅 / 充值')).toHaveAttribute(
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

    const user = userEvent.setup()
    render(<SidePanel />)
    await screen.findByTestId('sidepanel-sentence')

    await user.click(screen.getByText('Cats'))
    await user.click(screen.getByText('great'))

    await waitFor(() => {
      const definitions = screen.getByTestId('sidepanel-definitions')
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

    const user = userEvent.setup()
    render(<SidePanel />)
    await screen.findByTestId('sidepanel-sentence')

    await user.click(screen.getByText('great'))

    await waitFor(() => {
      const definitions = screen.getByTestId('sidepanel-definitions')
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
    expect(within(card).queryByText(/音标加载中/)).not.toBeInTheDocument()
    expect(within(card).queryByText(/词典释义加载中/)).not.toBeInTheDocument()
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
      expect(screen.getByTestId('sidepanel-definitions')).toHaveTextContent('句子中途过期')
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

    await user.click(screen.getByText('great'))

    const errorRow = await screen.findByTestId('sidepanel-context-error-great')
    expect(errorRow).toHaveTextContent('Your session has expired. Please login again.')

    await user.click(within(errorRow).getByTestId('sidepanel-retry-context-great'))

    await waitFor(() => {
      expect(screen.queryByTestId('sidepanel-context-error-great')).not.toBeInTheDocument()
      expect(screen.getByTestId('sidepanel-definitions')).toHaveTextContent('很棒的')
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

    const user = userEvent.setup()
    render(<SidePanel />)
    await screen.findByTestId('sidepanel-sentence')

    await user.click(screen.getByText('great'))

    await waitFor(() => {
      const card = screen.getByTestId('sidepanel-card-great')
      expect(card).toHaveTextContent('/greɪt/')
      expect(card).toHaveTextContent('很棒的')
      expect(card).toHaveTextContent('翻译中...')
    })

    resolveContext({ success: true, chinese: 'great在这句里的意思' })

    await waitFor(() => {
      const card = screen.getByTestId('sidepanel-card-great')
      expect(card).toHaveTextContent('great在这句里的意思')
      expect(card).not.toHaveTextContent('翻译中...')
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

    const user = userEvent.setup()
    render(<SidePanel />)
    await screen.findByTestId('sidepanel-sentence')

    await user.click(screen.getByText('Cats'))
    await user.click(screen.getByText('great'))
    await waitFor(() => expect(screen.getByTestId('sidepanel-card-cats')).toHaveTextContent('cats释义'))

    const callsAfterTwoDistinctWords = mockSendMessage.mock.calls.length
    await user.click(screen.getByText('Cats'))

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

    const user = userEvent.setup()
    render(<SidePanel />)
    await screen.findByTestId('sidepanel-sentence')

    await user.click(screen.getByText('great'))

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
    await waitFor(() =>
      expect(screen.getByTestId('sidepanel-chinese')).toHaveTextContent('第二句。')
    )
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

  // ADR-006: a word looked up via the page's WordPopup should show up in the
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
      expect(card).not.toHaveTextContent('翻译中...')
    })
    expect(mockSendMessage).not.toHaveBeenCalled()
  })

  it('inserts a page-looked-up word into the existing card list and clears the current sentence display (ADR-006)', async () => {
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

    const user = userEvent.setup()
    render(<SidePanel />)
    await screen.findByTestId('sidepanel-sentence')
    await user.click(screen.getByText('great'))
    await waitFor(() =>
      expect(screen.getByTestId('sidepanel-card-great')).toHaveTextContent('great在这句里的意思')
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

    // The pre-existing sentence card stays; the new one is inserted on top.
    await waitFor(() => {
      const cards = screen.getAllByTestId(/^sidepanel-card-/)
      expect(cards.map(c => c.getAttribute('data-testid'))).toEqual([
        'sidepanel-card-serendipity',
        'sidepanel-card-great',
      ])
    })
    // Sentence original text + translation are cleared, not just hidden.
    expect(screen.queryByTestId('sidepanel-sentence')).not.toBeInTheDocument()
    expect(screen.queryByTestId('sidepanel-chinese')).not.toBeInTheDocument()
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

  it('backfills the in-sentence meaning when clicking a word that already has a page-lookup card (contextStatus "none")', async () => {
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

    // 1) Word looked up on the page first -- card has dictionary data but
    //    contextStatus 'none' (no sentence yet).
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
    const card = await screen.findByTestId('sidepanel-card-cats')
    expect(card).toHaveTextContent('猫的复数')
    expect(card).not.toHaveTextContent('翻译中...')

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

    const callsBeforeClick = mockSendMessage.mock.calls.length

    // 3) Clicking "Cats" in the sentence should backfill the in-sentence
    //    meaning onto the existing card, not silently do nothing.
    const user = userEvent.setup()
    await user.click(screen.getByText('Cats'))

    await waitFor(() =>
      expect(screen.getByTestId('sidepanel-card-cats')).toHaveTextContent('cats在这句里的意思')
    )
    // Dictionary half is untouched -- reused, not re-fetched.
    expect(screen.getByTestId('sidepanel-card-cats')).toHaveTextContent('猫的复数')
    expect(screen.getByTestId('sidepanel-card-cats')).not.toHaveTextContent('猫释义(重新查询)')
    expect(
      mockSendMessage.mock.calls.slice(callsBeforeClick).some(call => call[0]?.type === 'getOneWord')
    ).toBe(false)
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
      const highlighted = within(sentence)
        .getAllByRole('button')
        .filter(b => b.getAttribute('data-clicked-word') === 'true')
      expect(highlighted).toHaveLength(2)
      highlighted.forEach(b => expect(b).toHaveTextContent('great'))
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
      expect(screen.queryByTestId('sidepanel-definitions')).not.toBeInTheDocument()
      const sentence = screen.getByTestId('sidepanel-sentence')
      expect(
        within(sentence)
          .getAllByRole('button')
          .some(b => b.getAttribute('data-clicked-word') === 'true')
      ).toBe(false)
    })
  })
})
