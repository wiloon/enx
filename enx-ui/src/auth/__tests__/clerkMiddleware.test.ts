/**
 * @jest-environment node
 */
import {
  NextRequest,
  NextResponse,
  type NextFetchEvent,
  type NextMiddleware,
} from 'next/server'
import { clerkAdapter } from '../clerk'

const mockClerkMiddleware = jest.fn()
const mockClerkHandler = jest.fn()

jest.mock('@clerk/nextjs/server', () => ({
  clerkMiddleware: (...args: unknown[]) => mockClerkMiddleware(...args),
}))

const key = process.env.CLERK_PUBLISHABLE_KEY

afterEach(() => {
  if (key === undefined) delete process.env.CLERK_PUBLISHABLE_KEY
  else process.env.CLERK_PUBLISHABLE_KEY = key
})

it('handle builds clerkMiddleware once and returns its async response', async () => {
  process.env.CLERK_PUBLISHABLE_KEY = 'pk_test_runtime'
  const req = new NextRequest('https://enx.example/app')
  const event = {} as NextFetchEvent
  mockClerkMiddleware.mockReturnValue(mockClerkHandler)
  const response = NextResponse.next()
  mockClerkHandler.mockResolvedValue(response)

  const result: ReturnType<NextMiddleware> = clerkAdapter.handle(req, event)
  await expect(result).resolves.toBe(response)
  clerkAdapter.handle(req, event)

  expect(mockClerkMiddleware).toHaveBeenCalledTimes(1)
  expect(mockClerkMiddleware).toHaveBeenCalledWith(expect.any(Function), {
    publishableKey: 'pk_test_runtime',
  })
  expect(mockClerkHandler).toHaveBeenCalledWith(req, event)
})

// clerkMiddleware(handler) calls handler(auth, req, event) after its own auth
// work and adds its headers to whatever the handler returns.
type ClerkHandler = (auth: unknown, req: NextRequest) => unknown

it('handle lets Clerk return the page responder’s response', async () => {
  const req = new NextRequest('https://enx.example/privacy')
  const event = {} as NextFetchEvent
  const routed = NextResponse.rewrite('https://enx.example/en/privacy')
  mockClerkHandler.mockImplementation(async (r: NextRequest) => {
    const [userHandler] = mockClerkMiddleware.mock.calls[0] as [ClerkHandler]
    return (await userHandler({}, r)) ?? NextResponse.next()
  })

  await expect(clerkAdapter.handle(req, event, () => routed)).resolves.toBe(
    routed
  )
})

it('handle leaves a request without a responder to Clerk’s default', async () => {
  const req = new NextRequest('https://enx.example/app')
  const event = {} as NextFetchEvent
  let handlerResult: unknown = 'not called'
  mockClerkHandler.mockImplementation(async (r: NextRequest) => {
    const [userHandler] = mockClerkMiddleware.mock.calls[0] as [ClerkHandler]
    handlerResult = await userHandler({}, r)
    return NextResponse.next()
  })

  await clerkAdapter.handle(req, event)
  expect(handlerResult).toBeUndefined()
})
