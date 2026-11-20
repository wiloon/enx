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
  expect(mockClerkMiddleware).toHaveBeenCalledWith({
    publishableKey: 'pk_test_runtime',
  })
  expect(mockClerkHandler).toHaveBeenCalledWith(req, event)
})
