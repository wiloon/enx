import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Avoid loading the real sentry.ts (uses `import.meta`, which ts-jest can't
// parse under CommonJS) -- same reasoning as background.test.ts's env.ts mock.
jest.mock('@/lib/sentry', () => ({
  initSentry: jest.fn(),
}))

jest.mock('@/services/api', () => ({
  sendMessageToBackground: jest.fn(),
}))

import { sendMessageToBackground } from '@/services/api'
import { BackgroundResponse, PENDING_SENTENCE_STORAGE_KEY } from '@/types'
import SidePanel from '../SidePanel'

const mockSendMessage = sendMessageToBackground as jest.Mock

type StorageChangeListener = (
  changes: { [key: string]: chrome.storage.StorageChange },
  areaName: string
) => void

describe('SidePanel', () => {
  let storageChangeListener: StorageChangeListener | undefined

  beforeEach(() => {
    jest.clearAllMocks()
    storageChangeListener = undefined
    ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({})
    ;(chrome.storage.onChanged.addListener as jest.Mock).mockImplementation(
      (listener: StorageChangeListener) => {
        storageChangeListener = listener
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
        word: 'great',
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
        word: 'great',
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

  it('appends word cards on click instead of replacing the previous one, newest on top (spec §3.9/§4.5)', async () => {
    ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({
      [PENDING_SENTENCE_STORAGE_KEY]: {
        sentence: 'Cats are great pets.',
        word: 'great',
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
        word: 'great',
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

  it('renders the card progressively: dictionary info appears before the slower AI context translation resolves (spec §3.9)', async () => {
    ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({
      [PENDING_SENTENCE_STORAGE_KEY]: {
        sentence: 'Cats are great pets.',
        word: 'great',
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
        word: 'great',
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
        word: 'great',
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
      storageChangeListener?.(
        {
          [PENDING_SENTENCE_STORAGE_KEY]: {
            newValue: {
              sentence: 'First sentence.',
              word: 'first',
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
      storageChangeListener?.(
        {
          [PENDING_SENTENCE_STORAGE_KEY]: {
            newValue: {
              sentence: 'Second sentence.',
              word: 'second',
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
      storageChangeListener?.(
        {
          [PENDING_SENTENCE_STORAGE_KEY]: {
            newValue: {
              sentence: 'Should be ignored.',
              word: 'ignored',
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
})
