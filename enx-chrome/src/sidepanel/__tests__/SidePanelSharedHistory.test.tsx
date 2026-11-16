import { act, fireEvent, render, waitFor, within } from '@testing-library/react'

jest.mock('@/lib/sentry', () => ({
  initSentry: jest.fn(),
}))

jest.mock('@/config/env', () => ({
  config: {
    frontendBaseUrl: 'http://localhost:3000',
  },
}))

jest.mock('@/services/api', () => ({
  sendMessageToBackground: jest.fn(),
}))

import { sendMessageToBackground } from '@/services/api'
import { pendingSentenceKey } from '@/lib/sidePanel'
import {
  emptyPanelHistory,
  panelHistoryKey,
  type StoredPanelHistory,
} from '@/lib/panelHistoryStore'
import {
  PANEL_REQUEST_TIMEOUT_MS,
  PANEL_TIMEOUT_ERROR_MESSAGE,
  sentenceCardId,
} from '@/lib/panelHistory'
import SidePanel from '../SidePanel'

const PANEL_TAB_ID = 7
const PENDING_SENTENCE_STORAGE_KEY = pendingSentenceKey(PANEL_TAB_ID)
const HISTORY_KEY = panelHistoryKey(PANEL_TAB_ID)

const mockSendMessage = sendMessageToBackground as jest.Mock

type StorageChangeListener = (
  changes: { [key: string]: chrome.storage.StorageChange },
  areaName: string
) => void

const loadedSentence = (text: string, i: number) => ({
  kind: 'sentence' as const,
  id: sentenceCardId(`${text} ${i}`),
  sentence: `${text} ${i}`,
  clickedWord: '',
  status: 'loaded' as const,
  chinese: `译${i}`,
  errorMessage: '',
  words: [],
})

describe('SidePanel shared history (ADR-090)', () => {
  let storageChangeListeners: StorageChangeListener[]
  const fireStorageChange: StorageChangeListener = (changes, areaName) => {
    storageChangeListeners.forEach(listener => listener(changes, areaName))
  }

  let sessionBag: Record<string, unknown>
  let eventIdSeq = 0
  const nextEventId = () => `evt-${++eventIdSeq}`

  const seedSession = (data: Record<string, unknown>) => {
    Object.assign(sessionBag, data)
  }

  const mountPanel = () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const view = render(<SidePanel />, { container: root })
    return { root, ...view }
  }

  beforeEach(() => {
    jest.clearAllMocks()
    window.history.replaceState({}, '', `/sidepanel.html?tabId=${PANEL_TAB_ID}`)
    storageChangeListeners = []
    sessionBag = {}
    eventIdSeq = 0
    document.body.innerHTML = ''
    CSS.highlights.clear()
    ;(chrome.storage.session.get as jest.Mock).mockImplementation(
      async (keys?: string | string[] | Record<string, unknown> | null) => {
        if (keys == null) return { ...sessionBag }
        if (typeof keys === 'string') {
          return keys in sessionBag ? { [keys]: sessionBag[keys] } : {}
        }
        if (Array.isArray(keys)) {
          const out: Record<string, unknown> = {}
          for (const k of keys) {
            if (k in sessionBag) out[k] = sessionBag[k]
          }
          return out
        }
        const out: Record<string, unknown> = { ...keys }
        for (const k of Object.keys(keys)) {
          if (k in sessionBag) out[k] = sessionBag[k]
        }
        return out
      }
    )
    ;(chrome.storage.session.set as jest.Mock).mockImplementation(
      async (items: Record<string, unknown>) => {
        const changes: { [key: string]: chrome.storage.StorageChange } = {}
        for (const [key, value] of Object.entries(items)) {
          changes[key] = { oldValue: sessionBag[key], newValue: value }
          sessionBag[key] = value
        }
        fireStorageChange(changes, 'session')
      }
    )
    ;(chrome.storage.session.remove as jest.Mock).mockImplementation(
      async (keys: string | string[]) => {
        const list = Array.isArray(keys) ? keys : [keys]
        const changes: { [key: string]: chrome.storage.StorageChange } = {}
        for (const key of list) {
          changes[key] = { oldValue: sessionBag[key], newValue: undefined }
          delete sessionBag[key]
        }
        fireStorageChange(changes, 'session')
      }
    )
    ;(chrome.storage.local.get as jest.Mock).mockResolvedValue({})
    ;(chrome.tabs.sendMessage as jest.Mock).mockResolvedValue(undefined)
    ;(chrome.tabs.get as jest.Mock).mockResolvedValue({ id: PANEL_TAB_ID })
    ;(chrome.storage.onChanged.addListener as jest.Mock).mockImplementation(
      (listener: StorageChangeListener) => {
        storageChangeListeners.push(listener)
      }
    )
    ;(chrome.storage.onChanged.removeListener as jest.Mock).mockImplementation(
      () => {}
    )
    const heldLocks = new Set<string>()
    const lockWaiters = new Map<string, Array<() => void>>()
    const releaseWaiter = (name: string) => {
      const next = lockWaiters.get(name)?.shift()
      if (next) next()
      else heldLocks.delete(name)
    }
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: jest.fn(
          async (
            name: string,
            optionsOrCallback:
              { signal?: AbortSignal } | (() => Promise<unknown>),
            maybeCallback?: () => Promise<unknown>
          ) => {
            const callback =
              typeof optionsOrCallback === 'function'
                ? optionsOrCallback
                : maybeCallback!
            if (heldLocks.has(name)) {
              await new Promise<void>(resolve => {
                const q = lockWaiters.get(name) ?? []
                q.push(resolve)
                lockWaiters.set(name, q)
              })
            } else {
              heldLocks.add(name)
            }
            try {
              return await callback()
            } finally {
              releaseWaiter(name)
            }
          }
        ),
      },
    })
    mockSendMessage.mockResolvedValue({
      success: true,
      chinese: '猫是很棒的宠物。',
    })
  })

  it('one pending sentence → one translateSentence; both panels show the card', async () => {
    const panelA = mountPanel()
    const panelB = mountPanel()
    await within(panelA.root).findByTestId('sidepanel-empty-state')
    await within(panelB.root).findByTestId('sidepanel-empty-state')

    act(() => {
      fireStorageChange(
        {
          [PENDING_SENTENCE_STORAGE_KEY]: {
            newValue: {
              sentence: 'Cats are great pets.',
              word: '',
              createdAt: Date.now(),
              eventId: nextEventId(),
            },
          },
        },
        'session'
      )
    })

    await waitFor(() => {
      expect(
        within(panelA.root).getByTestId('sidepanel-sentence')
      ).toHaveTextContent('Cats are great pets.')
      expect(
        within(panelB.root).getByTestId('sidepanel-sentence')
      ).toHaveTextContent('Cats are great pets.')
    })
    await waitFor(() => {
      expect(
        within(panelA.root).getByTestId('sidepanel-chinese')
      ).toHaveTextContent('猫是很棒的宠物。')
      expect(
        within(panelB.root).getByTestId('sidepanel-chinese')
      ).toHaveTextContent('猫是很棒的宠物。')
    })

    const translateCalls = mockSendMessage.mock.calls.filter(
      ([message]) => message?.type === 'translateSentence'
    )
    expect(translateCalls).toHaveLength(1)
  })

  it('second panel mount after 5 claimed sentences shows all 5 and sends no messages', async () => {
    const history: StoredPanelHistory = {
      ...emptyPanelHistory(),
      entries: Array.from({ length: 5 }, (_, i) =>
        loadedSentence('Sentence', i)
      ),
      claimedSentenceEventIds: ['c0', 'c1', 'c2', 'c3', 'c4'],
      nextToken: 5,
    }
    seedSession({ [HISTORY_KEY]: history })

    const panelA = mountPanel()
    await waitFor(() =>
      expect(
        within(panelA.root).getAllByTestId('sidepanel-sentence')
      ).toHaveLength(5)
    )
    jest.clearAllMocks()

    const panelB = mountPanel()
    await waitFor(() =>
      expect(
        within(panelB.root).getAllByTestId('sidepanel-sentence')
      ).toHaveLength(5)
    )
    expect(mockSendMessage).not.toHaveBeenCalled()
  })

  it('Clear in panel A shows Undo in panel B; Undo in B restores both', async () => {
    const panelA = mountPanel()
    const panelB = mountPanel()
    await within(panelA.root).findByTestId('sidepanel-empty-state')

    act(() => {
      fireStorageChange(
        {
          [PENDING_SENTENCE_STORAGE_KEY]: {
            newValue: {
              sentence: 'Cats are great pets.',
              word: '',
              createdAt: Date.now(),
              eventId: nextEventId(),
            },
          },
        },
        'session'
      )
    })

    await within(panelA.root).findByTestId('sidepanel-chinese')
    await within(panelB.root).findByTestId('sidepanel-chinese')

    fireEvent.click(within(panelA.root).getByTestId('sidepanel-clear-all'))

    await waitFor(() => {
      expect(
        within(panelA.root).getByTestId('sidepanel-empty-state')
      ).toBeInTheDocument()
      expect(
        within(panelB.root).getByTestId('sidepanel-empty-state')
      ).toBeInTheDocument()
      expect(
        within(panelB.root).getByTestId('sidepanel-undo-clear')
      ).toBeInTheDocument()
    })

    fireEvent.click(within(panelB.root).getByTestId('sidepanel-undo-clear'))

    await waitFor(() => {
      expect(
        within(panelA.root).getByTestId('sidepanel-chinese')
      ).toHaveTextContent('猫是很棒的宠物。')
      expect(
        within(panelB.root).getByTestId('sidepanel-chinese')
      ).toHaveTextContent('猫是很棒的宠物。')
    })
  })

  describe('request timeout, chains and overlapping actions', () => {
    const SENTENCE = 'Cats are great pets.'
    const countOf = (type: string) =>
      mockSendMessage.mock.calls.filter(([m]) => m?.type === type).length
    const deferred = <T,>() => {
      let resolve!: (value: T) => void
      const promise = new Promise<T>(r => {
        resolve = r
      })
      return { promise, resolve }
    }
    const fireSentence = (eventId: string, word = '') =>
      fireStorageChange(
        {
          [PENDING_SENTENCE_STORAGE_KEY]: {
            newValue: {
              sentence: SENTENCE,
              word,
              createdAt: Date.now(),
              eventId,
            },
          },
        },
        'session'
      )
    const failedSentenceHistory = (): StoredPanelHistory => ({
      ...emptyPanelHistory(),
      entries: [
        {
          kind: 'sentence',
          id: sentenceCardId(SENTENCE),
          sentence: SENTENCE,
          clickedWord: '',
          status: 'error',
          chinese: '',
          errorMessage: 'Translation service unavailable',
          words: [],
        },
      ],
      nextToken: 1,
    })

    afterEach(() => {
      jest.useRealTimers()
    })

    it('owner page closed: the card becomes Retry on the other panel 120 s after it was sent, with no automatic resend', async () => {
      jest.useFakeTimers()
      mockSendMessage.mockImplementation(() => new Promise(() => {}))
      const panelA = mountPanel()
      const panelB = mountPanel()
      await within(panelA.root).findByTestId('sidepanel-empty-state')
      act(() => fireSentence(nextEventId()))
      await waitFor(() => {
        expect(
          within(panelB.root).getByTestId('sidepanel-loading')
        ).toBeInTheDocument()
      })
      expect(countOf('translateSentence')).toBe(1)

      act(() => panelA.unmount())
      await act(async () => {
        jest.advanceTimersByTime(PANEL_REQUEST_TIMEOUT_MS - 1)
      })
      expect(
        within(panelB.root).getByTestId('sidepanel-loading')
      ).toBeInTheDocument()

      await act(async () => {
        jest.advanceTimersByTime(1)
      })
      await waitFor(() =>
        expect(
          within(panelB.root).getByTestId('sidepanel-retry-sentence')
        ).toBeInTheDocument()
      )
      expect(within(panelB.root).getByTestId('sidepanel-error')).toHaveTextContent(
        PANEL_TIMEOUT_ERROR_MESSAGE
      )
      expect(countOf('translateSentence')).toBe(1)
    })

    it('keeps the loading card visible when the timeout write fails', async () => {
      seedSession({ [HISTORY_KEY]: { ...emptyPanelHistory(), entries: [{
        ...failedSentenceHistory().entries[0], status: 'loading', errorMessage: '',
        token: 1, startedAt: Date.now() - PANEL_REQUEST_TIMEOUT_MS,
      }] } })
      ;(chrome.storage.session.set as jest.Mock).mockRejectedValue(new Error('write failed'))
      const log = jest.spyOn(console, 'error').mockImplementation(() => {})
      const panel = mountPanel()
      await waitFor(() => expect(chrome.storage.session.set).toHaveBeenCalled())
      expect(within(panel.root).queryByTestId('sidepanel-retry-sentence')).toBeNull()
      expect(within(panel.root).getByTestId('sidepanel-loading')).toBeInTheDocument()
      log.mockRestore()
    })

    it('a panel mounted after the timeout shows the card as Retry (mount sweep)', async () => {
      seedSession({
        [HISTORY_KEY]: {
          ...emptyPanelHistory(),
          entries: [
            {
              ...failedSentenceHistory().entries[0],
              status: 'loading',
              errorMessage: '',
              token: 1,
              startedAt: Date.now() - PANEL_REQUEST_TIMEOUT_MS,
            },
          ],
        },
      })
      const panel = mountPanel()
      await within(panel.root).findByTestId('sidepanel-retry-sentence')
      expect(countOf('translateSentence')).toBe(0)
    })

    it('overlapping Retry clicks from two panels send exactly one request', async () => {
      seedSession({ [HISTORY_KEY]: failedSentenceHistory() })
      const panelA = mountPanel()
      const panelB = mountPanel()
      const retryA = await within(panelA.root).findByTestId(
        'sidepanel-retry-sentence'
      )
      const retryB = await within(panelB.root).findByTestId(
        'sidepanel-retry-sentence'
      )
      await act(async () => {
        fireEvent.click(retryA)
        fireEvent.click(retryB)
      })
      await waitFor(() => expect(countOf('translateSentence')).toBe(1))
      await act(async () => {
        await Promise.resolve()
      })
      expect(countOf('translateSentence')).toBe(1)
    })

    it('overlapping same-sentence events with an anchor word send one translation and one lookup', async () => {
      mockSendMessage.mockImplementation(() => new Promise(() => {}))
      const panelA = mountPanel()
      const panelB = mountPanel()
      await within(panelA.root).findByTestId('sidepanel-empty-state')
      act(() => {
        fireSentence('evt-x', 'great')
        fireSentence('evt-y', 'great')
      })
      await waitFor(() => expect(countOf('getOneWord')).toBe(1))
      await act(async () => {
        await Promise.resolve()
      })
      expect(countOf('translateSentence')).toBe(1)
      expect(countOf('getOneWord')).toBe(1)
      expect(
        within(panelB.root).getAllByTestId('sidepanel-sentence')
      ).toHaveLength(1)
    })

    it('does not send context when its history write fails', async () => {
      const dictionary = deferred<unknown>()
      mockSendMessage.mockImplementation(async message => {
        if (message.type === 'getOneWord') return dictionary.promise
        return { success: true, chinese: '译文' }
      })
      const panel = mountPanel()
      await within(panel.root).findByTestId('sidepanel-empty-state')
      act(() => fireSentence(nextEventId(), 'great'))
      await waitFor(() => expect(countOf('getOneWord')).toBe(1))
      const log = jest.spyOn(console, 'error').mockImplementation(() => {})
      ;(chrome.storage.session.set as jest.Mock).mockRejectedValue(new Error('write failed'))
      await act(async () => {
        dictionary.resolve({ success: false, error: 'Dictionary lookup failed' })
        await new Promise(resolve => setTimeout(resolve, 50))
      })
      expect(countOf('translateWordInContext')).toBe(0)
      log.mockRestore()
    })

    it('dictionary-then-context continues for the sending panel while the other one is the one in view', async () => {
      const dictionary = deferred<unknown>()
      mockSendMessage.mockImplementation(async message => {
        if (message.type === 'getOneWord') return dictionary.promise
        if (message.type === 'translateWordInContext') {
          return { success: true, chinese: '很棒的' }
        }
        return { success: true, chinese: '猫是很棒的宠物。' }
      })
      mountPanel()
      const panelB = mountPanel()
      await within(panelB.root).findByTestId('sidepanel-empty-state')
      act(() => fireSentence(nextEventId(), 'great'))
      await waitFor(() => expect(countOf('getOneWord')).toBe(1))
      await act(async () => {
        dictionary.resolve({ success: false, error: 'Dictionary lookup failed' })
      })
      await waitFor(() => expect(countOf('translateWordInContext')).toBe(1))
      await waitFor(() =>
        expect(
          within(panelB.root).getByTestId('sidepanel-card-great')
        ).toHaveTextContent('很棒的')
      )
    })

    it('a follow-up paused by Clear in the other panel is sent after Undo there', async () => {
      const dictionary = deferred<unknown>()
      mockSendMessage.mockImplementation(async message => {
        if (message.type === 'getOneWord') return dictionary.promise
        if (message.type === 'translateWordInContext') {
          return { success: true, chinese: '很棒的' }
        }
        return { success: true, chinese: '猫是很棒的宠物。' }
      })
      mountPanel()
      const panelB = mountPanel()
      await within(panelB.root).findByTestId('sidepanel-empty-state')
      act(() => fireSentence(nextEventId(), 'great'))
      await waitFor(() => expect(countOf('getOneWord')).toBe(1))

      fireEvent.click(await within(panelB.root).findByTestId('sidepanel-clear-all'))
      await within(panelB.root).findByTestId('sidepanel-undo-clear')
      await act(async () => {
        dictionary.resolve({ success: false, error: 'Dictionary lookup failed' })
      })
      await act(async () => {
        await Promise.resolve()
      })
      expect(countOf('translateWordInContext')).toBe(0)

      fireEvent.click(within(panelB.root).getByTestId('sidepanel-undo-clear'))
      await waitFor(() => expect(countOf('translateWordInContext')).toBe(1))
    })

    it('removing a card in one panel removes it from the other', async () => {
      seedSession({
        [HISTORY_KEY]: {
          ...emptyPanelHistory(),
          entries: [
            {
              ...failedSentenceHistory().entries[0],
              status: 'loaded',
              chinese: '猫是很棒的宠物。',
              errorMessage: '',
              words: [
                {
                  word: 'great',
                  key: 'great',
                  dictionaryStatus: 'loaded',
                  dictionaryChinese: 'adj. 很棒的',
                  contextStatus: 'loaded',
                  contextChinese: '很棒的',
                },
              ],
            },
          ],
        },
      })
      const panelA = mountPanel()
      const panelB = mountPanel()
      await within(panelB.root).findByTestId('sidepanel-card-great')
      await within(panelA.root).findByTestId('sidepanel-card-great')
      fireEvent.click(within(panelA.root).getByTestId('sidepanel-remove-great'))
      await waitFor(() => {
        expect(
          within(panelB.root).queryByTestId('sidepanel-card-great')
        ).toBeNull()
      })
    })
  })

  it('Undo window ends at expiresAt for a late-mounted panel', async () => {
    jest.useFakeTimers()
    const now = Date.now()
    jest.setSystemTime(now)
    const history: StoredPanelHistory = {
      ...emptyPanelHistory(),
      cleared: {
        generation: 1,
        entries: [loadedSentence('Cleared', 0)],
        expiresAt: now + 5000,
      },
      clearGeneration: 1,
    }
    seedSession({ [HISTORY_KEY]: history })

    jest.setSystemTime(now + 3000)
    const panel = mountPanel()
    await waitFor(() =>
      expect(
        within(panel.root).getByTestId('sidepanel-undo-clear')
      ).toBeInTheDocument()
    )

    act(() => {
      jest.advanceTimersByTime(2001)
    })

    await waitFor(() =>
      expect(
        within(panel.root).queryByTestId('sidepanel-undo-clear')
      ).not.toBeInTheDocument()
    )
    jest.useRealTimers()
  })

  it('duplicate eventId is skipped; two distinct events both process', async () => {
    const panelA = mountPanel()
    const panelB = mountPanel()
    await within(panelA.root).findByTestId('sidepanel-empty-state')

    const sharedCreatedAt = Date.now()
    act(() => {
      fireStorageChange(
        {
          [PENDING_SENTENCE_STORAGE_KEY]: {
            newValue: {
              sentence: 'Cats are great pets.',
              word: '',
              createdAt: sharedCreatedAt,
              eventId: 'same-evt',
            },
          },
        },
        'session'
      )
    })
    await within(panelA.root).findByTestId('sidepanel-chinese')

    act(() => {
      fireStorageChange(
        {
          [PENDING_SENTENCE_STORAGE_KEY]: {
            newValue: {
              sentence: 'Cats are great pets.',
              word: '',
              createdAt: sharedCreatedAt,
              eventId: 'same-evt',
            },
          },
        },
        'session'
      )
    })

    act(() => {
      fireStorageChange(
        {
          [PENDING_SENTENCE_STORAGE_KEY]: {
            newValue: {
              sentence: 'Dogs are great pets.',
              word: '',
              createdAt: sharedCreatedAt,
              eventId: 'other-evt',
            },
          },
        },
        'session'
      )
    })

    await waitFor(() => {
      expect(
        within(panelA.root).getAllByTestId('sidepanel-sentence')
      ).toHaveLength(2)
      expect(
        within(panelB.root).getAllByTestId('sidepanel-sentence')
      ).toHaveLength(2)
    })

    const translateCalls = mockSendMessage.mock.calls.filter(
      ([message]) => message?.type === 'translateSentence'
    )
    expect(translateCalls).toHaveLength(2)
  })
})
