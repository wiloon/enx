import {
  createReviewList,
  requestReviewList,
  type ReviewListRequestDeps,
} from '../reviewList'
import type { BackgroundResponse, WordData } from '@/types'

const rateLimited = (retryAfterMs?: number): BackgroundResponse => ({
  success: false,
  error: 'Too many requests. Please slow down and try again in a moment.',
  status: 429,
  code: 'too_many_requests',
  ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
})
const listed = (reviewWords: unknown): BackgroundResponse => ({
  success: true,
  reviewWords,
})

const state = (english: string, LoadCount: number): WordData => ({
  Key: english.toLowerCase(),
  English: english,
  Pronunciation: '',
  Chinese: '',
  LoadCount,
  Known: false,
  WordType: 0,
})

function deps(replies: (BackgroundResponse | Error)[]) {
  let sent = 0
  const slept: number[] = []
  const d: ReviewListRequestDeps = {
    send: async () => {
      sent++
      const next = replies.shift()
      if (next instanceof Error) throw next
      return next ?? { success: false }
    },
    sleep: async ms => {
      slept.push(ms)
    },
  }
  return { d, sent: () => sent, slept }
}

describe('requestReviewList', () => {
  it('maps list entries to review states keyed by the shared word key', async () => {
    const { d } = deps([listed([['Cat', 3], ["don't", 1]])])

    expect(await requestReviewList(d)).toEqual({
      ok: true,
      words: { cat: state('Cat', 3), "don't": state("don't", 1) },
    })
  })

  it('treats an empty list as success', async () => {
    const { d, sent } = deps([listed([])])

    expect(await requestReviewList(d)).toEqual({ ok: true, words: {} })
    expect(sent()).toBe(1)
  })

  it('reports a 200 whose body is not an array as lookup-failed', async () => {
    const { d } = deps([listed({ cat: 3 })])

    expect(await requestReviewList(d)).toEqual({
      ok: false,
      reason: 'lookup-failed',
    })
  })

  it('retries a transient failure once, at once', async () => {
    const { d, sent, slept } = deps([
      { success: false, error: 'boom' },
      listed([]),
    ])

    expect((await requestReviewList(d)).ok).toBe(true)
    expect(sent()).toBe(2)
    expect(slept).toEqual([])
  })

  it('retries a rejected background message once', async () => {
    const { d, sent } = deps([new Error('cold worker'), listed([])])

    expect((await requestReviewList(d)).ok).toBe(true)
    expect(sent()).toBe(2)
  })

  it('reports lookup-failed after the second failure', async () => {
    const { d, sent } = deps([new Error('cold worker'), { success: false }])

    expect(await requestReviewList(d)).toEqual({
      ok: false,
      reason: 'lookup-failed',
    })
    expect(sent()).toBe(2)
  })

  // ADR-060 Decision 4: retrying a rate-limited request at once only hits
  // the limit again.
  it('waits Retry-After before retrying a rate-limited request', async () => {
    const { d, slept } = deps([rateLimited(3000), listed([])])

    expect((await requestReviewList(d)).ok).toBe(true)
    expect(slept).toEqual([3000])
  })

  it('waits at least a second when the 429 gave a shorter or no Retry-After', async () => {
    const short = deps([rateLimited(200), listed([])])
    await requestReviewList(short.d)
    const none = deps([rateLimited(), listed([])])
    await requestReviewList(none.d)

    expect([...short.slept, ...none.slept]).toEqual([1000, 1000])
  })

  it('reports rate-limited when the retry is refused too', async () => {
    const { d } = deps([rateLimited(1000), rateLimited(1000)])

    expect(await requestReviewList(d)).toEqual({
      ok: false,
      reason: 'rate-limited',
    })
  })

  it('does not retry an expired session', async () => {
    const { d, sent } = deps([{ success: false, sessionExpired: true }])

    expect(await requestReviewList(d)).toEqual({
      ok: false,
      reason: 'session-expired',
    })
    expect(sent()).toBe(1)
  })

  // ADR-062 Decision 5: a disabled account stays disabled; no retry.
  it('does not retry a disabled account', async () => {
    const { d, sent } = deps([
      {
        success: false,
        error: 'This account has been disabled.',
        status: 403,
        code: 'account_disabled',
      },
      listed([]),
    ])

    expect(await requestReviewList(d)).toEqual({
      ok: false,
      reason: 'account-disabled',
    })
    expect(sent()).toBe(1)
  })
})

describe('createReviewList', () => {
  // A request the test answers when it likes.
  const pendingRequests = () => {
    const resolvers: ((r: BackgroundResponse) => void)[] = []
    const send = jest.fn(
      () =>
        new Promise<BackgroundResponse>(resolve => resolvers.push(resolve))
    )
    return { send, answer: (i: number, r: BackgroundResponse) => resolvers[i](r) }
  }

  const setup = (stoodDown = () => false) => {
    const requests = pendingRequests()
    const cache: Record<string, WordData> = {}
    const list = createReviewList({
      send: requests.send,
      sleep: async () => {},
      cache,
      isStoodDown: stoodDown,
    })
    return { ...requests, cache, list }
  }

  it('fills the cache and reuses a successful load without another request', async () => {
    const { send, answer, cache, list } = setup()

    const first = list.load()
    answer(0, listed([['cat', 2]]))
    expect(await first).toEqual({ ok: true })
    expect(await list.load()).toEqual({ ok: true })

    expect(send).toHaveBeenCalledTimes(1)
    expect(cache).toEqual({ cat: state('cat', 2) })
  })

  it('shares one in-flight request between callers', async () => {
    const { send, answer, list } = setup()

    const first = list.load()
    const second = list.load()
    answer(0, listed([]))

    expect(await Promise.all([first, second])).toEqual([
      { ok: true },
      { ok: true },
    ])
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('keeps entries written during the request over the response', async () => {
    const { answer, cache, list } = setup()
    const load = list.load()
    const lookedUp = { ...state('cat', 5), Chinese: '猫' }
    cache.cat = lookedUp

    answer(0, listed([['cat', 2], ['dog', 1]]))
    await load

    expect(cache).toEqual({ cat: lookedUp, dog: state('dog', 1) })
  })

  it('does not remember a failed load, even with entries in the cache', async () => {
    const { d, sent } = deps([
      { success: false, error: 'boom' },
      { success: false, error: 'boom' },
      listed([['dog', 1]]),
    ])
    const cache: Record<string, WordData> = { cat: state('cat', 1) }
    const list = createReviewList({ ...d, cache, isStoodDown: () => false })

    expect(await list.load()).toEqual({ ok: false, reason: 'lookup-failed' })
    expect(await list.load()).toEqual({ ok: true })

    expect(sent()).toBe(3)
    expect(cache).toEqual({ cat: state('cat', 1), dog: state('dog', 1) })
  })

  it('clear() empties the cache and forgets the load', async () => {
    const { send, answer, cache, list } = setup()
    const first = list.load()
    answer(0, listed([['cat', 2]]))
    await first

    list.clear()
    expect(cache).toEqual({})

    const second = list.load()
    answer(1, listed([['dog', 1]]))
    await second
    expect(send).toHaveBeenCalledTimes(2)
    expect(cache).toEqual({ dog: state('dog', 1) })
  })

  it('never lets a response from before clear() restore its data', async () => {
    const { answer, cache, list } = setup()
    const old = list.load()

    list.clear()
    answer(0, listed([['cat', 2]]))
    await old

    expect(cache).toEqual({})
    const fresh = list.load()
    answer(1, listed([]))
    expect(await fresh).toEqual({ ok: true })
  })

  it('clears what it holds when the session has expired', async () => {
    const { answer, cache, list } = setup()
    cache.cat = state('cat', 1)

    const load = list.load()
    answer(0, { success: false, sessionExpired: true })

    expect(await load).toEqual({ ok: false, reason: 'session-expired' })
    expect(cache).toEqual({})
  })

  it('does not fill the cache after the script stood down', async () => {
    let stoodDown = false
    const { answer, cache, list } = setup(() => stoodDown)
    const load = list.load()

    stoodDown = true
    answer(0, listed([['cat', 2]]))
    await load

    expect(cache).toEqual({})
  })
})
