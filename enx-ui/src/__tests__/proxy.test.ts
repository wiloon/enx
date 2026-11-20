/**
 * @jest-environment node
 */
import { NextRequest, type NextFetchEvent } from 'next/server'
import proxy from '../proxy'

const handle = jest.fn()

// proxy.ts delegates non-API requests to the selected auth adapter; the
// adapter itself is tested in src/auth/.
jest.mock('@/auth', () => ({
  getAuthAdapter: () => ({ handle: (...args: unknown[]) => handle(...args) }),
}))

const event = {} as NextFetchEvent

describe('proxy', () => {
  const savedEnv = { ...process.env }

  beforeEach(() => {
    handle.mockReset()
    process.env = { ...savedEnv }
  })

  afterAll(() => {
    process.env = savedEnv
  })

  it('rewrites /api/* to API_BASE_URL, keeping path and query', () => {
    process.env.API_BASE_URL = 'http://enx-api.enx.svc:8091/'

    const res = proxy(
      new NextRequest('https://enx.example/api/stats/overview?date=2026-09-20'),
      event
    ) as Response

    expect(res.headers.get('x-middleware-rewrite')).toBe(
      'http://enx-api.enx.svc:8091/api/stats/overview?date=2026-09-20'
    )
    expect(handle).not.toHaveBeenCalled()
  })

  it('returns a 500 JSON error for /api/* when API_BASE_URL is unset', async () => {
    delete process.env.API_BASE_URL
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    const res = proxy(
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

  it('returns the auth adapter’s async response for non-API paths', async () => {
    process.env.API_BASE_URL = 'http://enx-api.enx.svc:8091'
    const sentinel = new Response('adapter')
    handle.mockResolvedValue(sentinel)

    const req = new NextRequest('https://enx.example/app')
    await expect(proxy(req, event)).resolves.toBe(sentinel)
    expect(handle).toHaveBeenCalledWith(req, event)
  })

  it('does not treat /apiary as an API path', () => {
    process.env.API_BASE_URL = 'http://enx-api.enx.svc:8091'

    proxy(new NextRequest('https://enx.example/apiary'), event)
    expect(handle).toHaveBeenCalledTimes(1)
  })
})
