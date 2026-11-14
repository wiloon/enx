// Reading positions (ADR-081, ADR-082, ADR-083; #897): the background's one
// writer, driven through the real message handler on a fake
// chrome.storage.local. Clerk decides whose position a message records.
jest.mock('@/config/env', () => ({
  config: {
    apiBaseUrl: 'http://localhost:8090',
    frontendBaseUrl: 'http://localhost:3000',
    clerkPublishableKey: 'pk_test_x',
    clerkSyncHost: 'https://clerk.localhost.test',
    uiOrigins: ['http://localhost:3000'],
    environment: 'test',
  },
}))
jest.mock('@clerk/chrome-extension/client', () => ({
  createClerkClient: jest.fn(),
}))

import { createClerkClient } from '@clerk/chrome-extension/client'
import {
  __resetClerkClientCacheForTests,
  __restartReadingPositionWriterForTests,
} from '../background'

const onMessage = (chrome.runtime.onMessage.addListener as jest.Mock).mock
  .calls[0][0] as (
  request: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void
) => boolean

const BOOK = 'https://standardebooks.org/ebooks/a/b/text/single-page'
const OTHER_BOOK = 'https://example.com/another-book'
const KEY_A = 'readingPositions:user-a'
const KEY_B = 'readingPositions:user-b'

let signedInAs: string | null
let local: Record<string, unknown>
let failingSets: number
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const bytesOf = (key: string) =>
  new TextEncoder().encode(key + JSON.stringify(local[key])).length

const anchor = (sentence: string, occurredAt: number, sourceUrl = BOOK) => ({
  sentence,
  before: 'the words before it',
  after: 'the words after it',
  offset: 4200,
  articleLength: 90000,
  sourceUrl,
  title: 'A Book',
  occurredAt,
})

const send = (request: unknown, tabId = 1) =>
  new Promise<Record<string, unknown>>(resolve => {
    onMessage(request, { tab: { id: tabId } }, resolve as (r: unknown) => void)
  })
const record = (bookKey: string, a: ReturnType<typeof anchor>, tabId = 1) =>
  send({ type: 'recordReadingPosition', bookKey, anchor: a }, tabId)
const open = (bookKey: string) => send({ type: 'openReadingPosition', bookKey })
const settle = async <T>(pending: Promise<T>) => {
  await jest.advanceTimersByTimeAsync(2000)
  return pending
}

type Books = Record<
  string,
  { position: { sentence: string }; touchedAt: number }
>
const storedBooks = (key = KEY_A) =>
  (local[key] as { books: Books } | undefined)?.books
const storedSentence = (bookKey = BOOK, key = KEY_A) =>
  storedBooks(key)?.[bookKey]?.position.sentence

beforeEach(() => {
  jest.useFakeTimers()
  jest.clearAllMocks()
  __resetClerkClientCacheForTests()
  __restartReadingPositionWriterForTests()
  signedInAs = 'user-a'
  local = {}
  failingSets = 0
  ;(createClerkClient as jest.Mock).mockImplementation(async () => ({
    get session() {
      return signedInAs ? { getToken: async () => 'jwt' } : null
    },
    get user() {
      return signedInAs ? { id: signedInAs } : null
    },
    client: { reload: async () => {} },
  }))
  const session: Record<string, unknown> = {}
  ;(chrome.storage.session.get as jest.Mock).mockImplementation(
    async (key: string) => ({ [key]: session[key] })
  )
  ;(chrome.storage.session.set as jest.Mock).mockImplementation(
    async (items: Record<string, unknown>) => Object.assign(session, items)
  )
  ;(chrome.storage.local.get as jest.Mock).mockImplementation(
    async (key: string) => (key in local ? { [key]: clone(local[key]) } : {})
  )
  ;(chrome.storage.local.set as jest.Mock).mockImplementation(
    async (items: Record<string, unknown>) => {
      if (failingSets > 0) {
        failingSets--
        throw new Error('QUOTA_BYTES quota exceeded')
      }
      Object.assign(local, clone(items))
    }
  )
  Object.assign(chrome.storage.local, {
    getKeys: jest.fn(async () => Object.keys(local)),
    getBytesInUse: jest.fn(async (keys: string[] | null) =>
      (keys ?? Object.keys(local))
        .filter(key => key in local)
        .reduce((total, key) => total + bytesOf(key), 0)
    ),
  })
  ;(chrome.tabs.query as jest.Mock).mockResolvedValue([])
  ;(chrome.runtime.sendMessage as jest.Mock).mockResolvedValue(undefined)
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  jest.clearAllTimers()
  jest.useRealTimers()
})

describe('recording a reading position', () => {
  it('writes the anchor under the signed-in user and the book key once the 2 s debounce ends', async () => {
    const pending = record(BOOK, anchor('It was a dark night.', 100))

    await jest.advanceTimersByTimeAsync(1900)
    expect(storedSentence()).toBeUndefined()

    expect(await settle(pending)).toEqual({ ok: true })
    expect(storedSentence()).toBe('It was a dark night.')
  })

  it('keeps the newest action by occurrence time when tabs report out of order', async () => {
    const newer = record(BOOK, anchor('Read in tab one.', 200), 1)
    const older = record(BOOK, anchor('Read earlier in tab two.', 100), 2)

    expect(await settle(newer)).toEqual({ ok: true })
    expect(await older).toEqual({ ok: true })
    expect(storedSentence()).toBe('Read in tab one.')
  })

  it('keeps the stored position when a delayed action is older than it', async () => {
    await settle(record(BOOK, anchor('The latest sentence.', 300)))

    await settle(record(BOOK, anchor('A stale sentence.', 100)))

    expect(storedSentence()).toBe('The latest sentence.')
  })

  it('loses no book when tabs write two books in the same window', async () => {
    const first = record(BOOK, anchor('First book.', 100), 1)
    const second = record(
      OTHER_BOOK,
      anchor('Second book.', 110, OTHER_BOOK),
      2
    )

    await settle(Promise.all([first, second]))

    expect(storedSentence(BOOK)).toBe('First book.')
    expect(storedSentence(OTHER_BOOK)).toBe('Second book.')
  })

  it('writes at once when a hidden or unloading tab asks for a flush', async () => {
    const pending = record(BOOK, anchor('Before the tab hid.', 100))

    await send({ type: 'flushReadingPositions' })

    expect(storedSentence()).toBe('Before the tab hid.')
    expect(await pending).toEqual({ ok: true })
  })
})

describe('rejected actions keep the previous position', () => {
  beforeEach(async () => {
    await settle(record(BOOK, anchor('The previous sentence.', 100)))
  })

  it('skips a sentence over 1 KB of UTF-8 without truncating it', async () => {
    // 600 characters, 1200 bytes.
    const result = await settle(record(BOOK, anchor('é'.repeat(600), 200)))

    expect(result).toEqual({ ok: false, code: 'sentence-too-large' })
    expect(storedSentence()).toBe('The previous sentence.')
  })

  it('rejects an anchor whose source URL is not a normalized page address', async () => {
    const result = await settle(
      record(BOOK, anchor('Elsewhere.', 200, 'chrome://extensions/'))
    )

    expect(result).toEqual({ ok: false, code: 'invalid-anchor' })
    expect(storedSentence()).toBe('The previous sentence.')
  })

  it('reports a failed write, keeps the previous position and writes again next time', async () => {
    failingSets = 1

    const failed = await settle(record(BOOK, anchor('Lost write.', 200)))

    expect(failed).toEqual({ ok: false, code: 'write-failed' })
    expect(storedSentence()).toBe('The previous sentence.')

    await settle(record(BOOK, anchor('Next write.', 300)))
    expect(storedSentence()).toBe('Next write.')
  })

  it('reports a failed flush instead of success and keeps the previous position', async () => {
    failingSets = 1
    const pending = record(BOOK, anchor('Lost on flush.', 200))

    const reply = await send({ type: 'flushReadingPositions' })

    expect(reply).toEqual({ ok: false, code: 'write-failed' })
    expect(await pending).toEqual({ ok: false, code: 'write-failed' })
    expect(storedSentence()).toBe('The previous sentence.')
  })

  it('refuses a write that would take the feature past 4 MB across all accounts', async () => {
    local[KEY_B] = {
      books: { [OTHER_BOOK]: { filler: 'x'.repeat(4_194_000) } },
    }

    const result = await settle(
      record(BOOK, anchor('One sentence too many.', 200))
    )

    expect(result).toEqual({ ok: false, code: 'storage-full' })
    expect(storedSentence()).toBe('The previous sentence.')
  })

  it('refuses a write that would overrun the quota the extension shares', async () => {
    local.enxSwLog = 'x'.repeat(10_485_600)

    const result = await settle(
      record(BOOK, anchor('There is no room left for this one.', 200))
    )

    expect(result).toEqual({ ok: false, code: 'storage-full' })
    expect(storedSentence()).toBe('The previous sentence.')
  })

  it('loses only the pending action when the worker restarts during the debounce', async () => {
    void record(BOOK, anchor('Pending when the worker died.', 200))
    await jest.advanceTimersByTimeAsync(500)
    jest.clearAllTimers()
    __restartReadingPositionWriterForTests()

    expect(await open(BOOK)).toMatchObject({
      ok: true,
      position: { sentence: 'The previous sentence.' },
    })
    await jest.advanceTimersByTimeAsync(5000)
    expect(storedSentence()).toBe('The previous sentence.')
  })
})

describe('accounts', () => {
  it('records and shows nothing while signed out', async () => {
    signedInAs = null

    expect(await settle(record(BOOK, anchor('Nobody.', 100)))).toEqual({
      ok: false,
      code: 'signed-out',
    })
    expect(await open(BOOK)).toEqual({ ok: false, code: 'signed-out' })
    expect(Object.keys(local)).not.toContain(KEY_A)
  })

  it('writes a pending action to the account that made it after a switch, and restores it on re-login', async () => {
    const pending = record(BOOK, anchor('User A was reading this.', 100))
    await jest.advanceTimersByTimeAsync(100)
    signedInAs = 'user-b'

    expect(await settle(pending)).toEqual({ ok: true })
    expect(storedSentence(BOOK, KEY_A)).toBe('User A was reading this.')
    expect(local[KEY_B]).toBeUndefined()
    expect(await open(BOOK)).toEqual({ ok: true, position: null })

    signedInAs = null
    expect(await open(BOOK)).toEqual({ ok: false, code: 'signed-out' })

    signedInAs = 'user-a'
    expect(await open(BOOK)).toMatchObject({
      ok: true,
      position: { sentence: 'User A was reading this.' },
    })
  })
})

describe('the 20-book cap', () => {
  const bookUrl = (n: number) => `https://example.com/book-${n}`

  beforeEach(async () => {
    for (let n = 1; n <= 20; n++) {
      await settle(record(bookUrl(n), anchor(`Book ${n}.`, n, bookUrl(n))))
    }
  })

  it('evicts the book least recently opened or written', async () => {
    await open(bookUrl(1))

    await settle(record(bookUrl(21), anchor('Book 21.', 21, bookUrl(21))))

    const books = Object.keys(storedBooks() ?? {})
    expect(books).toHaveLength(20)
    expect(books).toContain(bookUrl(1))
    expect(books).not.toContain(bookUrl(2))
    expect(books).toContain(bookUrl(21))
  })

  it('creates no record when a page with no position is opened', async () => {
    expect(await open(bookUrl(99))).toEqual({ ok: true, position: null })

    expect(Object.keys(storedBooks() ?? {})).toHaveLength(20)
    expect(storedBooks()?.[bookUrl(99)]).toBeUndefined()
  })
})

it('logs neither the sentence nor the page address', async () => {
  const sentence = 'A private sentence about Mr. Darcy.'
  failingSets = 1

  await settle(record(BOOK, anchor(sentence, 100)))
  await settle(record(BOOK, anchor('é'.repeat(600), 200)))

  const logged = JSON.stringify(
    [console.log, console.warn, console.error].flatMap(
      fn => (fn as jest.Mock).mock.calls
    )
  )
  expect(logged).not.toContain('Mr. Darcy')
  expect(logged).not.toContain('standardebooks.org')
  expect(JSON.stringify(local.enxSwLog ?? [])).not.toContain('Mr. Darcy')
})
