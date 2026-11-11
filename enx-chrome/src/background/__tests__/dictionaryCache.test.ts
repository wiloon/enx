import 'fake-indexeddb/auto'
import { serialize, deserialize } from 'node:v8'
// jsdom has no structuredClone; use Node's structured serialization for IDB.
globalThis.structuredClone = value => deserialize(serialize(value))
jest.mock('@/config/env', () => ({
  config: {
    apiBaseUrl: 'http://localhost:8090',
    frontendBaseUrl: 'http://localhost:3000',
    clerkPublishableKey: 'pk_test_x',
    clerkSyncHost: 'https://clerk.test',
    uiOrigins: [],
    environment: 'test',
  },
}))
jest.mock('@clerk/chrome-extension/client', () => ({
  createClerkClient: async () => ({
    session: { getToken: async () => 'token' },
    user: { id: 'cache-user' },
  }),
}))
import { __resetClerkClientCacheForTests } from '../background'

const listener = (chrome.runtime.onMessage.addListener as jest.Mock).mock
  .calls[0][0]
const send = (message: object): Promise<Record<string, unknown>> =>
  new Promise(resolve => listener(message, {}, resolve))
const entry = {
  Word: 'Cat',
  Status: 'found',
  Id: 'cat-id',
  English: 'cat',
  Chinese: '猫',
  Pronunciation: 'kæt',
  WordType: 0,
  Origin: 'ecdict',
}
const definition = {
  Id: 'cat-id',
  Key: 'cat',
  English: 'cat',
  Chinese: '猫',
  Pronunciation: 'kæt',
  WordType: 0,
  Origin: 'ecdict',
}
const reply = (status: number, data: unknown) => ({
  ok: status < 400,
  status,
  headers: new Headers(),
  json: async () => data,
  text: async () => JSON.stringify(data),
})
const calls = () =>
  (fetch as jest.Mock).mock.calls.map(([url, init]) => ({
    url: String(url).replace('http://localhost:8090', ''),
    method: init?.method ?? 'GET',
    contentType: init?.headers?.['Content-Type'],
    body: init?.body ? JSON.parse(init.body) : undefined,
  }))
beforeEach(async () => {
  ;(chrome.tabs.query as jest.Mock).mockResolvedValue([])
  ;(chrome.storage.local.remove as jest.Mock).mockResolvedValue(undefined)
  global.fetch = jest.fn().mockResolvedValue(reply(200, [entry]))
  await send({ type: 'accountSignedOut' })
  __resetClerkClientCacheForTests()
})

it('reads a cache miss with one JSON QUERY and serves the next lookup from the cache', async () => {
  expect(await send({ type: 'getOneWord', word: ' Cat ' })).toEqual({
    success: true,
    ecp: definition,
  })
  expect(calls()).toEqual([
    {
      url: '/api/dictionary/entries',
      method: 'QUERY',
      contentType: 'application/json',
      body: { words: ['Cat'] },
    },
  ])
  expect(await send({ type: 'getOneWord', word: 'CAT' })).toEqual({
    success: true,
    ecp: { ...definition, Origin: undefined },
  })
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('retries a QUERY refused with 405 once as POST with the same body', async () => {
  ;(fetch as jest.Mock)
    .mockResolvedValueOnce(reply(405, {}))
    .mockResolvedValueOnce(reply(200, [entry]))
  expect(await send({ type: 'getOneWord', word: 'cat' })).toMatchObject({
    success: true,
    ecp: { Id: 'cat-id' },
  })
  expect(calls().map(({ method, url, body }) => [method, url, body])).toEqual([
    ['QUERY', '/api/dictionary/entries', { words: ['cat'] }],
    ['POST', '/api/dictionary/entries/query', { words: ['cat'] }],
  ])
})

it('records a lookup with only the word id and passes the authoritative count back', async () => {
  ;(fetch as jest.Mock).mockResolvedValue(
    reply(200, { queryCount: 21, known: false })
  )
  expect(await send({ type: 'recordWordLookup', wordId: 'cat-id' })).toEqual({
    success: true,
    queryCount: 21,
    known: false,
  })
  expect(calls()[0].body).toEqual({ wordId: 'cat-id' })
})

it('passes a quota refusal through without retrying the recording POST', async () => {
  ;(fetch as jest.Mock).mockResolvedValue(
    reply(429, { code: 'lookup_quota_exceeded', message: 'Quota reached' })
  )
  expect(
    await send({ type: 'recordWordLookup', wordId: 'cat-id' })
  ).toMatchObject({
    success: false,
    status: 429,
    code: 'lookup_quota_exceeded',
    error: 'Quota reached',
  })
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('passes a quota refusal of the QUERY through without falling back', async () => {
  ;(fetch as jest.Mock).mockResolvedValue(
    reply(429, { code: 'lookup_quota_exceeded', message: 'Quota reached' })
  )
  expect(await send({ type: 'getOneWord', word: 'cat' })).toMatchObject({
    success: false,
    status: 429,
    code: 'lookup_quota_exceeded',
  })
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('answers a word no dictionary knows with its AI offer and does not cache it', async () => {
  ;(fetch as jest.Mock).mockResolvedValue(
    reply(200, [
      {
        Word: 'zorbly',
        Status: 'not_found',
        AIFallback: { CanUse: true, Auto: true },
      },
    ])
  )
  expect(await send({ type: 'getOneWord', word: 'zorbly' })).toEqual({
    success: true,
    ecp: {
      Key: 'zorbly',
      English: 'zorbly',
      Pronunciation: '',
      Chinese: '',
      WordType: 0,
      AIFallback: { CanUse: true, Auto: true },
    },
  })
  await send({ type: 'getOneWord', word: 'zorbly' })
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('reports a failed entry as a lookup failure', async () => {
  ;(fetch as jest.Mock).mockResolvedValue(
    reply(200, [{ Word: 'cat', Status: 'failed' }])
  )
  expect(await send({ type: 'getOneWord', word: 'cat' })).toMatchObject({
    success: false,
  })
})

it('explicit sign-out removes definitions from the next lookup', async () => {
  await send({ type: 'getOneWord', word: 'cat' })
  await send({ type: 'accountSignedOut' })
  __resetClerkClientCacheForTests()
  await send({ type: 'getOneWord', word: 'cat' })
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('refreshing a stale id fetches and caches the replacement definition', async () => {
  await send({ type: 'getOneWord', word: 'cat' })
  ;(fetch as jest.Mock).mockResolvedValue(
    reply(200, [{ ...entry, Id: 'new-id' }])
  )
  expect(
    await send({ type: 'getOneWord', word: 'cat', refresh: true })
  ).toMatchObject({ ecp: { Id: 'new-id' } })
  expect(await send({ type: 'getOneWord', word: 'cat' })).toMatchObject({
    ecp: { Id: 'new-id' },
  })
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('does not repopulate the cache when an old QUERY completes after explicit sign-out', async () => {
  let finish!: (value: ReturnType<typeof reply>) => void
  ;(fetch as jest.Mock).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  const pending = send({ type: 'getOneWord', word: 'cat' })
  while (!finish) await new Promise(resolve => setTimeout(resolve, 0))
  await send({ type: 'accountSignedOut' })
  finish(reply(200, [entry]))
  await pending
  __resetClerkClientCacheForTests()
  await send({ type: 'getOneWord', word: 'cat' })
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('a cache write failure still returns the server definition', async () => {
  const fail = jest
    .spyOn(IDBObjectStore.prototype, 'put')
    .mockImplementationOnce(() => {
      throw new DOMException('Storage full', 'QuotaExceededError')
    })
  try {
    expect(await send({ type: 'getOneWord', word: 'cat' })).toEqual({
      success: true,
      ecp: definition,
    })
  } finally {
    fail.mockRestore()
  }
})

describe('prefetching definitions', () => {
  const found = (word: string) => ({
    ...entry,
    Word: word,
    Id: `${word}-id`,
    English: word,
  })

  it('reads the uncached words with one JSON QUERY and caches only found entries', async () => {
    await send({ type: 'getOneWord', word: 'cat' })
    ;(fetch as jest.Mock).mockClear()
    ;(fetch as jest.Mock).mockResolvedValueOnce(
      reply(200, [
        found('fox'),
        { ...found('robot'), Origin: 'ai' },
        { Word: 'zorbly', Status: 'not_found', AIFallback: { CanUse: true } },
        { Word: 'ran', Status: 'failed' },
      ])
    )

    expect(
      await send({
        type: 'prefetchDefinitions',
        words: ['cat', 'fox', 'robot', 'zorbly', 'ran'],
      })
    ).toEqual({ success: true })
    expect(calls()).toEqual([
      {
        url: '/api/dictionary/entries',
        method: 'QUERY',
        contentType: 'application/json',
        body: { words: ['fox', 'robot', 'zorbly', 'ran'] },
      },
    ])

    ;(fetch as jest.Mock).mockClear()
    expect(await send({ type: 'getOneWord', word: 'Fox' })).toMatchObject({
      ecp: { Id: 'fox-id', Key: 'fox' },
    })
    expect(fetch).not.toHaveBeenCalled()
    for (const word of ['robot', 'zorbly', 'ran']) {
      await send({ type: 'getOneWord', word })
    }
    expect(calls().map(({ body }) => body?.words)).toEqual([
      ['robot'],
      ['zorbly'],
      ['ran'],
    ])
  })

  it.each([
    ['405', () => reply(405, {})],
    ['a network error', () => Promise.reject(new TypeError('Failed to fetch'))],
  ])(
    'falls back once to POST on %s, and retries neither',
    async (_name, refusal) => {
      ;(fetch as jest.Mock).mockImplementation(refusal)
      expect(
        await send({ type: 'prefetchDefinitions', words: ['fox'] })
      ).toEqual({ success: true })
      expect(
        calls().map(({ method, url, body }) => [method, url, body])
      ).toEqual([
        ['QUERY', '/api/dictionary/entries', { words: ['fox'] }],
        ['POST', '/api/dictionary/entries/query', { words: ['fox'] }],
      ])
    }
  )

  it.each([
    ['a quota refusal', () => reply(429, { code: 'lookup_quota_exceeded' }), 1],
    ['a server error', () => reply(500, { success: false, error: 'boom' }), 1],
    ['a gateway 503', () => reply(503, {}), 1],
    ['a 401, after its one token refresh', () => reply(401, {}), 2],
  ])('stays silent on %s with no other retry', async (_name, refusal, sent) => {
    ;(fetch as jest.Mock).mockImplementation(refusal)
    expect(await send({ type: 'prefetchDefinitions', words: ['fox'] })).toEqual(
      { success: true }
    )
    expect(calls().map(({ method }) => method)).toEqual(
      Array(sent).fill('QUERY')
    )
  })

  it('leaves a cached entry untouched: no request and no last-used refresh', async () => {
    await send({ type: 'getOneWord', word: 'cat' })
    ;(fetch as jest.Mock).mockClear()
    const put = jest.spyOn(IDBObjectStore.prototype, 'put')
    try {
      await send({ type: 'prefetchDefinitions', words: ['Cat’s'] })
      expect(fetch).not.toHaveBeenCalled()
      expect(put).not.toHaveBeenCalled()
    } finally {
      put.mockRestore()
    }
  })

  it('writes nothing when sign-out lands during the batch', async () => {
    let finish!: (value: ReturnType<typeof reply>) => void
    ;(fetch as jest.Mock).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve
        })
    )
    const pending = send({ type: 'prefetchDefinitions', words: ['fox'] })
    while (!finish) await new Promise(resolve => setTimeout(resolve, 0))
    await send({ type: 'accountSignedOut' })
    finish(reply(200, [found('fox')]))
    await pending
    __resetClerkClientCacheForTests()
    ;(fetch as jest.Mock).mockClear()
    await send({ type: 'getOneWord', word: 'fox' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

it('still serves the cached definition when updating its last-used timestamp fails', async () => {
  await send({ type: 'getOneWord', word: 'cat' })
  const fail = jest
    .spyOn(IDBObjectStore.prototype, 'put')
    .mockImplementationOnce(() => {
      throw new DOMException('Storage full', 'QuotaExceededError')
    })
  try {
    expect(await send({ type: 'getOneWord', word: 'cat' })).toMatchObject({
      success: true,
      ecp: { Chinese: '猫' },
    })
    expect(fetch).toHaveBeenCalledTimes(1)
  } finally {
    fail.mockRestore()
  }
})
