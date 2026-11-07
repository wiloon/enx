/**
 * @jest-environment node
 */
// #688: the installed @clerk/chrome-extension and clerk-js, loaded the way the
// worker loads them (createClerkClient with background: true), with Clerk's
// Frontend API answered at the fetch boundary. The node environment has no
// window and no WorkerGlobalScope, so clerk-js sees no navigator, as in an
// offline MV3 worker: it swallows a failed request and resolves the load
// with no session.
import { classifyLoadedClerk } from '../clerkSessionSync'

jest.mock('webextension-polyfill', () => ({
  __esModule: true,
  default: {
    runtime: {
      getManifest: () => ({
        permissions: ['storage', 'cookies'],
        host_permissions: ['https://clerk.example.test/*'],
        background: { service_worker: 'background.js' },
      }),
    },
    cookies: {
      get: async () => ({ value: 'dvb_test' }),
      onChanged: {
        addListener: () => {},
        hasListener: () => false,
        removeListener: () => {},
      },
    },
    storage: {
      local: {
        get: async () => ({}),
        set: async () => {},
        remove: async () => {},
      },
    },
  },
}))

const PUBLISHABLE_KEY =
  'pk_test_' + Buffer.from('clerk.example.test$').toString('base64')

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
const ENVIRONMENT = { object: 'environment', id: 'env_test' }
const SIGNED_OUT_CLIENT = {
  response: { object: 'client', id: 'client_test', sessions: [] },
  client: null,
}

// What Clerk's Frontend API does with a /v1/client request, first during
// the load and then for the read after it.
type Answer = 'signed-out' | 'blocked' | 'rate-limited'
let phase: 'load' | 'read'
const frontendApi = (load: Answer, read: Answer) => {
  const fetch = jest.fn(async (url: string | URL) => {
    const path = new URL(String(url)).pathname
    if (path === '/v1/environment') return json(200, ENVIRONMENT)
    const answer = phase === 'load' ? load : read
    if (answer === 'blocked') throw new TypeError('Failed to fetch')
    if (answer === 'rate-limited')
      return json(429, { errors: [{ code: 'too_many_requests' }] })
    return json(200, SIGNED_OUT_CLIENT)
  })
  global.fetch = fetch as unknown as typeof globalThis.fetch
  return fetch
}

const loadClerk = async () => {
  phase = 'load'
  const { createClerkClient } = jest.requireActual(
    '@clerk/chrome-extension/client'
  )
  const clerk = await settle(
    createClerkClient({
      publishableKey: PUBLISHABLE_KEY,
      syncHost: 'https://clerk.example.test',
      background: true,
    })
  )
  phase = 'read'
  return clerk
}

// clerk-js retries a failed GET up to 11 times with backoff (about 40 s).
const settle = async <T>(work: Promise<T>): Promise<T> => {
  let done = false
  const settled = work.finally(() => {
    done = true
  })
  for (let tick = 0; !done; tick++) {
    if (tick > 200) throw new Error('Clerk never settled')
    await jest.advanceTimersByTimeAsync(5_000)
    await new Promise(resolve => setImmediate(resolve))
  }
  return settled
}

// clerk-js opens BroadcastChannels for cross-tab token sharing; Node's keep
// the test process alive.
class InertBroadcastChannel {
  addEventListener() {}
  removeEventListener() {}
  postMessage() {}
  close() {}
}
const RealBroadcastChannel = globalThis.BroadcastChannel

beforeEach(() => {
  globalThis.BroadcastChannel =
    InertBroadcastChannel as unknown as typeof BroadcastChannel
  jest.resetModules()
  // Response bodies are read on real ticks.
  jest.useFakeTimers({
    doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'],
  })
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  globalThis.BroadcastChannel = RealBroadcastChannel
  jest.useRealTimers()
  jest.restoreAllMocks()
})

it('confirms the session is gone when the Frontend API answers with a signed-out client', async () => {
  const fetch = frontendApi('signed-out', 'signed-out')

  const clerk = await loadClerk()
  expect(clerk.session).toBeNull()

  expect(await settle(classifyLoadedClerk(clerk))).toBe('absent')
  const clientRequests = fetch.mock.calls.filter(([url]) =>
    String(url).includes('/v1/client')
  )
  // The load's read, and the one read after it.
  expect(clientRequests).toHaveLength(2)
})

it('leaves the session unconfirmed when the Frontend API is blocked, though the load resolves empty', async () => {
  frontendApi('blocked', 'blocked')

  const clerk = await loadClerk()
  // The silent failure: no error, status ready, no session.
  expect(clerk.status).toBe('ready')
  expect(clerk.session).toBeNull()

  expect(await settle(classifyLoadedClerk(clerk))).toBe('unconfirmed')
})

it('leaves the session unconfirmed when the Frontend API is blocked after a signed-out load', async () => {
  frontendApi('signed-out', 'blocked')

  const clerk = await loadClerk()

  expect(await settle(classifyLoadedClerk(clerk))).toBe('unconfirmed')
})

it('leaves the session unconfirmed when the read is rate limited', async () => {
  frontendApi('signed-out', 'rate-limited')

  const clerk = await loadClerk()

  expect(await settle(classifyLoadedClerk(clerk))).toBe('unconfirmed')
})
