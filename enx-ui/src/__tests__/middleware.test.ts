/**
 * @jest-environment node
 */
import { NextRequest, type NextFetchEvent } from 'next/server'

const clerkHandler = jest.fn()
const clerkMiddleware = jest.fn<typeof clerkHandler, unknown[]>(
  () => clerkHandler
)

jest.mock('@clerk/nextjs/server', () => ({
  clerkMiddleware: (...args: unknown[]) => clerkMiddleware(...args),
}))

// middleware.ts builds the Clerk handler at import time from the runtime
// CLERK_PUBLISHABLE_KEY, so the env must be set before it is loaded.
async function loadMiddleware() {
  let mod: typeof import('../middleware') | undefined
  await jest.isolateModulesAsync(async () => {
    mod = await import('../middleware')
  })
  return mod!
}

const event = {} as NextFetchEvent

describe('middleware', () => {
  const savedEnv = { ...process.env }

  beforeEach(() => {
    clerkHandler.mockReset()
    clerkMiddleware.mockClear()
    process.env = { ...savedEnv }
  })

  afterAll(() => {
    process.env = savedEnv
  })

  it('passes the runtime publishable key to clerkMiddleware', async () => {
    process.env.CLERK_PUBLISHABLE_KEY = 'pk_test_runtime'
    await loadMiddleware()
    expect(clerkMiddleware).toHaveBeenCalledWith({
      publishableKey: 'pk_test_runtime',
    })
  })

  it('rewrites /api/* to API_BASE_URL, keeping path and query', async () => {
    process.env.API_BASE_URL = 'http://enx-api.enx.svc:8091/'
    const { default: middleware } = await loadMiddleware()

    const res = middleware(
      new NextRequest('https://enx.example/api/stats/overview?date=2026-09-20'),
      event
    ) as Response

    expect(res.headers.get('x-middleware-rewrite')).toBe(
      'http://enx-api.enx.svc:8091/api/stats/overview?date=2026-09-20'
    )
    expect(clerkHandler).not.toHaveBeenCalled()
  })

  it('returns a 500 JSON error for /api/* when API_BASE_URL is unset', async () => {
    delete process.env.API_BASE_URL
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const { default: middleware } = await loadMiddleware()

    const res = middleware(
      new NextRequest('https://enx.example/api/me'),
      event
    ) as Response

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({
      error: 'API_BASE_URL is not configured on this server',
    })
    expect(res.headers.get('x-middleware-rewrite')).toBeNull()
    errorSpy.mockRestore()
  })

  it('hands non-API paths to Clerk', async () => {
    process.env.API_BASE_URL = 'http://enx-api.enx.svc:8091'
    const sentinel = new Response('clerk')
    clerkHandler.mockReturnValue(sentinel)
    const { default: middleware } = await loadMiddleware()

    const req = new NextRequest('https://enx.example/app')
    expect(middleware(req, event)).toBe(sentinel)
    expect(clerkHandler).toHaveBeenCalledWith(req, event)
  })

  it('does not treat /apiary as an API path', async () => {
    process.env.API_BASE_URL = 'http://enx-api.enx.svc:8091'
    const { default: middleware } = await loadMiddleware()

    middleware(new NextRequest('https://enx.example/apiary'), event)
    expect(clerkHandler).toHaveBeenCalledTimes(1)
  })
})
