import {
  createDefinitionPrefetcher,
  createPagePrefetch,
  PREFETCH_BATCH_SIZE,
} from '@/lib/definitionPrefetch'
import type { EntriesTransportResult } from '@/lib/dictionaryEntries'
import type { WordData } from '@/types'

const state = (fields: Partial<WordData> = {}): WordData => ({
  Key: '',
  English: '',
  Pronunciation: '',
  Chinese: '',
  WordType: 0,
  LoadCount: 1,
  Known: false,
  ...fields,
})

describe('createPagePrefetch', () => {
  const setup = () => {
    const sent: string[][] = []
    const page = createPagePrefetch(words => sent.push(words))
    return { sent, page }
  }

  it('sends the reviewable page words once each, by cache key', () => {
    const { sent, page } = setup()
    page.request(['Fox', 'fox’s', "FOX'S", 'dog', 'cat', 'ran'], {
      fox: state(),
      dog: state({ Known: true }),
      cat: state({ LoadCount: 0 }),
      ran: state(),
    })
    expect(sent).toEqual([['fox', 'ran']])
  })

  it('skips words already requested on this page, and sends nothing new', () => {
    const { sent, page } = setup()
    const states = { fox: state(), ran: state() }
    page.request(['fox'], states)
    page.request(['fox', 'ran'], states)
    page.request(['ran', 'fox'], states)
    expect(sent).toEqual([['fox'], ['ran']])
  })

  it('asks again for every word after a reset', () => {
    const { sent, page } = setup()
    const states = { fox: state() }
    page.request(['fox'], states)
    page.reset()
    page.request(['fox'], states)
    expect(sent).toEqual([['fox'], ['fox']])
  })
})

type Send = jest.Mock<
  Promise<EntriesTransportResult>,
  ['QUERY' | 'POST', string, string]
>

const found = (word: string, fields: Record<string, unknown> = {}) => ({
  Word: word,
  Status: 'found',
  Id: `${word.toLowerCase()}-id`,
  English: word.toLowerCase(),
  Chinese: '释义',
  Pronunciation: '',
  WordType: 0,
  Origin: 'ecdict',
  ...fields,
})

describe('createDefinitionPrefetcher', () => {
  let cached: Map<string, WordData>
  let peek: jest.Mock
  let put: jest.Mock
  let generation: number
  let send: Send

  // Answers each QUERY with `found` for every requested word.
  const answerAll: Send = jest.fn(async (_method, _path, body) => ({
    success: true,
    data: (JSON.parse(body).words as string[]).map(word => found(word)),
  }))

  const prefetcher = () =>
    createDefinitionPrefetcher({
      cache: { peek, put },
      send,
      generation: () => generation,
    })
  const bodies = () =>
    send.mock.calls.map(([method, path, body]) => [
      method,
      path,
      JSON.parse(body).words,
    ])

  beforeEach(() => {
    cached = new Map()
    peek = jest.fn(async (word: string) => cached.get(word))
    put = jest.fn(async (word: string, data: WordData) => {
      cached.set(word, data)
    })
    generation = 0
    send = jest.fn(answerAll)
  })

  it('reads only the words without a usable cached entry, once each', async () => {
    cached.set('fox', state({ Id: 'fox-id' }))
    await prefetcher().prefetch(['fox', 'ran', ' Ran ', 'cat’s'])
    expect(bodies()).toEqual([
      ['QUERY', '/api/dictionary/entries', ['ran', 'cat']],
    ])
    expect(put.mock.calls.map(([word]) => word)).toEqual(['ran', 'cat'])
  })

  it(`splits more than ${PREFETCH_BATCH_SIZE} misses into batches`, async () => {
    const words = Array.from({ length: 250 }, (_, i) => `word${i}`)
    await prefetcher().prefetch(words)
    expect(bodies().map(([, , batch]) => batch.length)).toEqual([100, 100, 50])
    expect(put).toHaveBeenCalledTimes(250)
  })

  it('maps results by the key of the echoed word, whatever its case or order', async () => {
    send.mockResolvedValueOnce({
      success: true,
      data: [
        found('Cat', { English: 'cat', Id: 'cat-id' }),
        found('ran', { English: 'run', Id: 'run-id' }),
        found('stranger'),
      ],
    })
    await prefetcher().prefetch(['ran', 'cat'])
    expect(put.mock.calls).toEqual([
      ['cat', expect.objectContaining({ Id: 'cat-id', Key: 'cat' })],
      ['ran', expect.objectContaining({ Id: 'run-id', English: 'run' })],
    ])
  })

  it('writes only found dictionary entries with an Id', async () => {
    send.mockResolvedValueOnce({
      success: true,
      data: [
        found('fox'),
        found('noid', { Id: undefined }),
        found('robot', { Origin: 'ai' }),
        { Word: 'zorbly', Status: 'not_found', AIFallback: { CanUse: true } },
        { Word: 'cat', Status: 'failed' },
      ],
    })
    await prefetcher().prefetch(['fox', 'noid', 'robot', 'zorbly', 'cat'])
    expect(put.mock.calls.map(([word]) => word)).toEqual(['fox'])
  })

  it.each([
    ['405', { success: false, status: 405 }],
    ['a network error', { success: false, networkError: true }],
  ])('falls back to one POST on %s', async (_name, refusal) => {
    send.mockResolvedValueOnce(refusal)
    await prefetcher().prefetch(['fox'])
    expect(bodies()).toEqual([
      ['QUERY', '/api/dictionary/entries', ['fox']],
      ['POST', '/api/dictionary/entries/query', ['fox']],
    ])
    expect(put).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['429', { success: false, status: 429, code: 'lookup_quota_exceeded' }],
    ['401', { success: false, status: 401, sessionUnverified: true }],
    ['500', { success: false, status: 500 }],
    ['a malformed answer', { success: true, data: { fox: 1 } }],
  ])('gives up silently on %s', async (_name, refusal) => {
    send.mockResolvedValue(refusal)
    await expect(prefetcher().prefetch(['fox'])).resolves.toBeUndefined()
    expect(send).toHaveBeenCalledTimes(1)
    expect(put).not.toHaveBeenCalled()
  })

  it('gives up silently when the transport throws or a cache call fails', async () => {
    send.mockRejectedValueOnce(new Error('boom'))
    await expect(prefetcher().prefetch(['fox'])).resolves.toBeUndefined()

    peek.mockRejectedValueOnce(new Error('closed'))
    put.mockRejectedValueOnce(new Error('full'))
    await expect(prefetcher().prefetch(['ran'])).resolves.toBeUndefined()
    expect(bodies()[1]).toEqual(['QUERY', '/api/dictionary/entries', ['ran']])
  })

  it('writes nothing when the cache generation changed during the read', async () => {
    send.mockImplementationOnce(async (...args) => {
      generation++
      return answerAll(...args)
    })
    await prefetcher().prefetch(['fox'])
    expect(put).not.toHaveBeenCalled()
  })

  it('sends no later batch after the cache generation changed', async () => {
    send.mockImplementationOnce(async (...args) => {
      generation++
      return answerAll(...args)
    })
    await prefetcher().prefetch(
      Array.from({ length: 150 }, (_, i) => `word${i}`)
    )
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('does not read a word already in flight, and reads it again once done', async () => {
    let finish!: () => void
    send.mockImplementationOnce(async (...args) => {
      await new Promise<void>(resolve => {
        finish = resolve
      })
      return answerAll(...args)
    })
    const store = prefetcher()
    const first = store.prefetch(['fox', 'ran'])
    while (!finish) await new Promise(resolve => setTimeout(resolve, 0))
    await store.prefetch(['fox', 'cat'])
    expect(bodies().map(([, , batch]) => batch)).toEqual([
      ['fox', 'ran'],
      ['cat'],
    ])
    finish()
    await first

    cached.clear()
    await store.prefetch(['fox'])
    expect(bodies().map(([, , batch]) => batch)[2]).toEqual(['fox'])
  })
})
