import {
  MAX_ATTEMPTS,
  STATS_QUEUE_STORAGE_KEY,
  enqueueReport,
  flushQueue,
  localDate,
  utcOffsetMinutes,
  type QueuedReport,
} from '../statsReporter'

// chrome.storage.local backed by a plain object, so a test can inspect the
// queue the way the next service-worker instance would read it.
let store: Record<string, unknown> = {}

// jsdom's Crypto implements getRandomValues but not randomUUID, which every
// MV3 service worker has. Counter-based so an id is readable in a failure.
let uuidCounter = 0
beforeAll(() => {
  Object.defineProperty(global.crypto, 'randomUUID', {
    configurable: true,
    value: () => `uuid-${++uuidCounter}`,
  })
})

beforeEach(() => {
  store = {}
  ;(global as any).chrome.storage.local.get = jest.fn(async (key: string) => ({
    [key]: store[key],
  }))
  ;(global as any).chrome.storage.local.set = jest.fn(
    async (items: Record<string, unknown>) => {
      Object.assign(store, items)
    }
  )
})

function queue(): QueuedReport[] {
  return (store[STATS_QUEUE_STORAGE_KEY] as QueuedReport[]) ?? []
}

const ok = () =>
  jest.fn(async () => ({ success: true, data: { applied: true } }))
const failing = (status?: number) =>
  jest.fn(async () => ({ success: false, error: 'nope', status }))

describe('localDate / utcOffsetMinutes', () => {
  it("reports the offset in the server's sign convention (UTC+8 -> +480)", () => {
    const utcPlus8 = { getTimezoneOffset: () => -480 } as Date
    expect(utcOffsetMinutes(utcPlus8)).toBe(480)
  })

  it('formats the local day, not the UTC day', () => {
    // 2026-01-01T07:00 local is still 2025-12-31 in UTC; the local day wins.
    expect(localDate(new Date(2026, 0, 1, 7, 0))).toBe('2026-01-01')
  })
})

describe('enqueueReport', () => {
  it('sends the delta and leaves nothing queued on success', async () => {
    const request = ok()

    await enqueueReport({ wordsRead: 340, articlesRead: 1 }, request)

    expect(request).toHaveBeenCalledTimes(1)
    const [endpoint, options] = request.mock.calls[0] as [string, RequestInit]
    expect(endpoint).toBe('/api/stats/ingest')
    expect(JSON.parse(options.body as string)).toMatchObject({
      delta: { wordsRead: 340, articlesRead: 1 },
    })
    expect(queue()).toHaveLength(0)
  })

  it('does not call the API for an all-zero delta', async () => {
    const request = ok()

    await enqueueReport({ wordsRead: 0, articlesRead: 0 }, request)

    expect(request).not.toHaveBeenCalled()
  })

  it('keeps a transiently failed report for the next attempt', async () => {
    await enqueueReport({ wordsRead: 100 }, failing(500))

    expect(queue()).toHaveLength(1)
    expect(queue()[0].attempts).toBe(1)
  })

  it('reuses the same clientEventId on a retry, so the server can dedupe it', async () => {
    await enqueueReport({ wordsRead: 100 }, failing(500))
    const id = queue()[0].clientEventId

    const request = ok()
    await flushQueue(request)

    const body = JSON.parse(
      (request.mock.calls[0][1] as RequestInit).body as string
    )
    expect(body.clientEventId).toBe(id)
    expect(queue()).toHaveLength(0)
  })

  it('drops a report the server rejects as malformed', async () => {
    await enqueueReport({ wordsRead: 100 }, failing(400))

    expect(queue()).toHaveLength(0)
  })

  it('retries a 429 rather than dropping it', async () => {
    await enqueueReport({ wordsRead: 100 }, failing(429))

    expect(queue()).toHaveLength(1)
  })

  it('gives up on a report that keeps failing', async () => {
    const request = failing(500)
    await enqueueReport({ wordsRead: 100 }, request)
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      await flushQueue(request)
    }

    expect(queue()).toHaveLength(0)
  })

  it('stops at the first transient failure instead of draining out of order', async () => {
    store[STATS_QUEUE_STORAGE_KEY] = [
      {
        clientEventId: 'a',
        localDate: '2026-01-01',
        utcOffsetMinutes: 0,
        delta: { wordsRead: 1 },
        attempts: 0,
      },
      {
        clientEventId: 'b',
        localDate: '2026-01-01',
        utcOffsetMinutes: 0,
        delta: { wordsRead: 2 },
        attempts: 0,
      },
    ]
    const request = failing(503)

    await flushQueue(request)

    expect(request).toHaveBeenCalledTimes(1)
    expect(queue().map(r => r.clientEventId)).toEqual(['a', 'b'])
  })
})
