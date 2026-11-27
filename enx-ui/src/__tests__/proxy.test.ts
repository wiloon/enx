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

  describe('localised public paths', () => {
    // Like Clerk: the adapter runs the page responder it is given and
    // returns its response.
    beforeEach(() => {
      handle.mockImplementation(
        (req: NextRequest, _event: unknown, respond?: Responder) =>
          respond ? respond(req) : new Response('adapter')
      )
    })

    type Responder = (req: NextRequest) => Response | Promise<Response>

    async function run(path: string, headers?: Record<string, string>) {
      const req = new NextRequest(`https://enx.example${path}`, { headers })
      const res = (await proxy(req, event)) as Response
      return { req, res }
    }

    it('serves /privacy as the English page, through the auth adapter', async () => {
      const { req, res } = await run('/privacy')

      expect(handle).toHaveBeenCalledWith(req, event, expect.any(Function))
      expect(res.status).toBe(200)
      expect(res.headers.get('x-middleware-rewrite')).toBe(
        'https://enx.example/en/privacy'
      )
    })

    it.each(['/zh/privacy', '/zh/terms', '/zh/refund'])(
      'serves %s as the Chinese page',
      async (path) => {
        const { res } = await run(path)

        expect(res.status).toBe(200)
        expect(res.headers.get('location')).toBeNull()
        const rewrite = res.headers.get('x-middleware-rewrite')
        if (rewrite) expect(new URL(rewrite).pathname).toBe(path)
      }
    )

    it('redirects /en/privacy to the unprefixed URL', async () => {
      const { res } = await run('/en/privacy')

      expect([307, 308]).toContain(res.status)
      expect(res.headers.get('location')).toBe('https://enx.example/privacy')
    })

    it('does not redirect a Chinese browser away from /privacy', async () => {
      const { res } = await run('/privacy', {
        'accept-language': 'zh-CN,zh;q=0.9',
      })

      expect(res.status).toBe(200)
      expect(res.headers.get('location')).toBeNull()
      expect(res.headers.get('x-middleware-rewrite')).toBe(
        'https://enx.example/en/privacy'
      )
    })

    it('ignores a UI language choice cookie when routing a URL', async () => {
      const { res } = await run('/privacy', {
        cookie: 'catglish_ui_language=zh; NEXT_LOCALE=zh',
      })

      expect(res.headers.get('location')).toBeNull()
      expect(res.headers.get('x-middleware-rewrite')).toBe(
        'https://enx.example/en/privacy'
      )
    })

    it('sets no cookie when /zh/privacy is opened', async () => {
      const { res } = await run('/zh/privacy')

      expect(res.headers.get('set-cookie')).toBeNull()
    })
  })

  describe('other pages', () => {
    it.each([
      '/',
      '/app',
      '/sign-in',
      '/pricing',
      '/zh/pricing',
      '/en/pricing',
    ])('hands %s to the auth adapter alone, as before', (path) => {
      const req = new NextRequest(`https://enx.example${path}`)
      proxy(req, event)

      expect(handle).toHaveBeenCalledTimes(1)
      expect(handle.mock.calls[0]).toEqual([req, event])
    })

    it('hands a signed-in request to the auth adapter with its session cookie', () => {
      const req = new NextRequest('https://enx.example/app', {
        headers: { cookie: '__session=signed-in-token' },
      })
      proxy(req, event)

      const [received] = handle.mock.calls[0] as [NextRequest]
      expect(received.cookies.get('__session')?.value).toBe('signed-in-token')
    })
  })
})
