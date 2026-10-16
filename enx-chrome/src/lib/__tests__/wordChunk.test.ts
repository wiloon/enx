import { fetchWordChunk, type WordChunkDeps } from '../wordChunk'
import type { BackgroundResponse } from '@/types'

const rateLimited = (retryAfterMs?: number): BackgroundResponse => ({
  success: false,
  error: 'Too many requests. Please slow down and try again in a moment.',
  status: 429,
  code: 'too_many_requests',
  ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
})
const words = { cat: { Id: 'w1', English: 'cat' } }
const ok: BackgroundResponse = {
  success: true,
  wordProperties: words as unknown as BackgroundResponse['wordProperties'],
}

function deps(replies: (BackgroundResponse | Error)[]) {
  const sent: string[] = []
  const slept: number[] = []
  const d: WordChunkDeps = {
    send: async paragraph => {
      sent.push(paragraph)
      const next = replies.shift()
      if (next instanceof Error) throw next
      return next ?? { success: false }
    },
    sleep: async ms => {
      slept.push(ms)
    },
    isStale: () => false,
  }
  return { d, sent, slept }
}

describe('fetchWordChunk', () => {
  it('returns the words of a chunk the server answered', async () => {
    const { d, sent } = deps([ok])

    expect(await fetchWordChunk(['cat', 'dog'], d)).toEqual({
      kind: 'ok',
      words,
    })
    expect(sent).toEqual(['cat dog'])
  })

  it('unwraps word data the server nested under data', async () => {
    const { d } = deps([
      {
        success: true,
        wordProperties: {
          data: words,
        } as unknown as BackgroundResponse['wordProperties'],
      },
    ])

    expect(await fetchWordChunk(['cat'], d)).toEqual({ kind: 'ok', words })
  })

  it('retries a failed chunk once, at once', async () => {
    const { d, sent, slept } = deps([{ success: false, error: 'boom' }, ok])

    expect((await fetchWordChunk(['cat'], d)).kind).toBe('ok')
    expect(sent).toHaveLength(2)
    expect(slept).toEqual([])
  })

  it('gives up after the second failure', async () => {
    const { d, sent } = deps([new Error('cold worker'), { success: false }])

    expect(await fetchWordChunk(['cat'], d)).toEqual({ kind: 'failed' })
    expect(sent).toHaveLength(2)
  })

  // ADR-060 Decision 4: retrying a rate-limited request at once only hits
  // the limit again.
  it('waits Retry-After before retrying a rate-limited chunk', async () => {
    const { d, slept } = deps([rateLimited(3000), ok])

    expect((await fetchWordChunk(['cat'], d)).kind).toBe('ok')
    expect(slept).toEqual([3000])
  })

  it('waits at least a second when the 429 gave no Retry-After', async () => {
    const { d, slept } = deps([rateLimited(), ok])

    await fetchWordChunk(['cat'], d)

    expect(slept).toEqual([1000])
  })

  it('reports a chunk still rate-limited after its retry', async () => {
    const { d } = deps([rateLimited(1000), rateLimited(1000)])

    expect(await fetchWordChunk(['cat'], d)).toEqual({ kind: 'rate-limited' })
  })

  it('does not retry an expired session', async () => {
    const { d, sent } = deps([{ success: false, sessionExpired: true }])

    expect(await fetchWordChunk(['cat'], d)).toEqual({
      kind: 'session-expired',
    })
    expect(sent).toHaveLength(1)
  })

  it('stops when a newer run took over while the chunk was in flight', async () => {
    const { d, sent } = deps([{ success: false }, ok])
    d.isStale = () => true

    expect(await fetchWordChunk(['cat'], d)).toEqual({ kind: 'stale' })
    expect(sent).toHaveLength(1)
  })
})
