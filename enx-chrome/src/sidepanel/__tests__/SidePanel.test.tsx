import { act, render, screen, waitFor } from '@testing-library/react'
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
import { PENDING_SENTENCE_STORAGE_KEY } from '@/types'
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

  it('appends word definitions on click instead of replacing the previous one (spec §4.5, "追加显示")', async () => {
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
            // Deliberately different from the translateWordInContext value
            // above -- this field must NOT show up in the Side Panel (spec
            // §3.7 2026-08-03 change: only Pronunciation is used from here).
            Chinese: `${message.word}的通用词典释义`,
            Pronunciation: `/${message.word}/`,
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
      expect(definitions).not.toHaveTextContent('通用词典释义')
    })
  })

  it('still shows pronunciation when the contextual translation fails, and vice versa (spec §4.5, 互不阻塞)', async () => {
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
    })
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
