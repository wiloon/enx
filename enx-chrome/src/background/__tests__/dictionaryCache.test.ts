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
const definition = {
  Id: 'cat-id',
  English: 'cat',
  Chinese: '猫',
  Pronunciation: 'kæt',
  WordType: 0,
  LoadCount: 3,
  Known: true,
}
const reply = (status: number, data: object) => ({
  ok: status < 400,
  status,
  headers: new Headers(),
  json: async () => data,
  text: async () => JSON.stringify(data),
})
beforeEach(async () => {
  ;(chrome.tabs.query as jest.Mock).mockResolvedValue([])
  ;(chrome.storage.local.remove as jest.Mock).mockResolvedValue(undefined)
  global.fetch = jest.fn().mockResolvedValue(reply(200, definition))
  await send({ type: 'accountSignedOut' })
  __resetClerkClientCacheForTests()
})

it('reuses dictionary data on the next getOneWord without sending a GET or POST', async () => {
  expect(await send({ type: 'getOneWord', word: ' Cat ' })).toMatchObject({
    success: true,
    fromCache: false,
    ecp: definition,
  })
  expect(await send({ type: 'getOneWord', word: 'CAT' })).toEqual({
    success: true,
    fromCache: true,
    ecp: {
      Id: 'cat-id',
      Key: 'cat',
      English: 'cat',
      Chinese: '猫',
      Pronunciation: 'kæt',
      WordType: 0,
    },
  })
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('passes cache metering and the authoritative count through the recording message', async () => {
  ;(fetch as jest.Mock).mockResolvedValue(
    reply(200, { queryCount: 21, known: false })
  )
  expect(
    await send({ type: 'recordWordLookup', wordId: 'cat-id', fromCache: true })
  ).toEqual({ success: true, queryCount: 21, known: false })
  expect(JSON.parse((fetch as jest.Mock).mock.calls[0][1].body)).toEqual({
    wordId: 'cat-id',
    fromCache: true,
  })
})

it('passes a quota refusal through without retrying the recording POST', async () => {
  ;(fetch as jest.Mock).mockResolvedValue(
    reply(429, { code: 'lookup_quota_exceeded', message: 'Quota reached' })
  )
  expect(
    await send({ type: 'recordWordLookup', wordId: 'cat-id', fromCache: true })
  ).toMatchObject({
    success: false,
    status: 429,
    code: 'lookup_quota_exceeded',
    error: 'Quota reached',
  })
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('explicit sign-out removes definitions from the next lookup', async () => {
  await send({ type: 'getOneWord', word: 'cat' })
  await send({ type: 'accountSignedOut' })
  __resetClerkClientCacheForTests()
  expect(await send({ type: 'getOneWord', word: 'cat' })).toMatchObject({
    fromCache: false,
  })
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('refreshing a stale id fetches and caches the replacement definition', async () => {
  await send({ type: 'getOneWord', word: 'cat' })
  ;(fetch as jest.Mock).mockResolvedValue(
    reply(200, { ...definition, Id: 'new-id' })
  )
  expect(
    await send({ type: 'getOneWord', word: 'cat', refresh: true })
  ).toMatchObject({ fromCache: false, ecp: { Id: 'new-id' } })
  expect(await send({ type: 'getOneWord', word: 'cat' })).toMatchObject({
    fromCache: true,
    ecp: { Id: 'new-id' },
  })
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('does not repopulate the cache when an old GET completes after explicit sign-out', async () => {
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
  finish(reply(200, definition))
  await pending
  __resetClerkClientCacheForTests()
  ;(fetch as jest.Mock).mockResolvedValue(reply(200, definition))
  expect(await send({ type: 'getOneWord', word: 'cat' })).toMatchObject({
    fromCache: false,
  })
})

it('a cache write failure still returns the server definition', async () => {
  const fail = jest
    .spyOn(IDBObjectStore.prototype, 'put')
    .mockImplementationOnce(() => {
      throw new DOMException('Storage full', 'QuotaExceededError')
    })
  try {
    expect(await send({ type: 'getOneWord', word: 'cat' })).toMatchObject({
      success: true,
      ecp: definition,
    })
  } finally {
    fail.mockRestore()
  }
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
      fromCache: true,
      ecp: { Chinese: '猫' },
    })
    expect(fetch).toHaveBeenCalledTimes(1)
  } finally {
    fail.mockRestore()
  }
})
