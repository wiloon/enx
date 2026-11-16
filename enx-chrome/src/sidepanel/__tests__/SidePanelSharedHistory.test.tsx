import {
  act,
  fireEvent,
  render,
  waitFor,
  within,
} from '@testing-library/react'

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
import { sentenceCardId } from '@/lib/panelHistory'
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
      heldLocks.delete(name)
      const next = lockWaiters.get(name)?.shift()
      next?.()
    }
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: jest.fn(
          async (
            name: string,
            optionsOrCallback:
              | { signal?: AbortSignal }
              | (() => Promise<unknown>),
            maybeCallback?: () => Promise<unknown>
          ) => {
            const callback =
              typeof optionsOrCallback === 'function'
                ? optionsOrCallback
                : maybeCallback!
            const options =
              typeof optionsOrCallback === 'function'
                ? undefined
                : optionsOrCallback
            // Lifetime hold (has AbortSignal): keep the lock until abort so
            // orphan sweeps queued on the same name wait, then run.
            if (
              String(name).startsWith('enx-panel-alive') &&
              options?.signal
            ) {
              return new Promise((_resolve, reject) => {
                heldLocks.add(name)
                options.signal!.addEventListener('abort', () => {
                  releaseWaiter(name)
                  reject(
                    options.signal?.reason ??
                      new DOMException('Aborted', 'AbortError')
                  )
                })
              })
            }
            if (heldLocks.has(name)) {
              await new Promise<void>(resolve => {
                const q = lockWaiters.get(name) ?? []
                q.push(resolve)
                lockWaiters.set(name, q)
              })
            }
            heldLocks.add(name)
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
      entries: Array.from({ length: 5 }, (_, i) => loadedSentence('Sentence', i)),
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

  it('unmounting the owner turns its loading card into Retry on the other panel', async () => {
    mockSendMessage.mockImplementation(
      () => new Promise(() => {}) // never resolves: keep loading
    )
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

    await waitFor(() => {
      expect(
        within(panelA.root).getByTestId('sidepanel-loading')
      ).toBeInTheDocument()
      expect(
        within(panelB.root).getByTestId('sidepanel-loading')
      ).toBeInTheDocument()
    })

    const translateBefore = mockSendMessage.mock.calls.filter(
      ([message]) => message?.type === 'translateSentence'
    ).length
    expect(translateBefore).toBe(1)

    act(() => {
      panelA.unmount()
    })

    await waitFor(() => {
      expect(
        within(panelB.root).getByTestId('sidepanel-error')
      ).toBeInTheDocument()
      expect(
        within(panelB.root).getByTestId('sidepanel-retry-sentence')
      ).toBeInTheDocument()
    })

    const translateAfter = mockSendMessage.mock.calls.filter(
      ([message]) => message?.type === 'translateSentence'
    ).length
    expect(translateAfter).toBe(1)
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
