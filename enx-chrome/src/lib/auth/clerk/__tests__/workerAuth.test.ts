import { createClerkClient } from '@clerk/chrome-extension/client'
import { createClerkWorkerAuth } from '@/lib/auth/clerk/workerAuth'

jest.mock('@clerk/chrome-extension/client', () => ({
  createClerkClient: jest.fn(),
}))

it('acquires tokens normally and bypasses the Clerk cache only for forced refresh', async () => {
  const getToken = jest
    .fn()
    .mockResolvedValueOnce('cached')
    .mockResolvedValueOnce('fresh')
  jest.mocked(createClerkClient).mockResolvedValue({
    session: { getToken },
  } as unknown as Awaited<ReturnType<typeof createClerkClient>>)
  const adapter = createClerkWorkerAuth({
    provider: 'clerk',
    publishableKey: 'pk_test_x',
    syncHost: 'https://clerk.example',
  })

  const client = await adapter.createClient()
  expect(await client.getToken()).toBe('cached')
  expect(await client.getToken({ forceRefresh: true })).toBe('fresh')
  expect(getToken).toHaveBeenNthCalledWith(1, undefined)
  expect(getToken).toHaveBeenNthCalledWith(2, { skipCache: true })
})

it('leaves an empty session unconfirmed when the Clerk client read rejects', async () => {
  jest.mocked(createClerkClient).mockResolvedValue({
    session: null,
    client: {
      reload: async () => {
        throw new Error('ClerkJS: Network error')
      },
    },
    __internal_onAfterResponse: jest.fn(),
  } as unknown as Awaited<ReturnType<typeof createClerkClient>>)
  const adapter = createClerkWorkerAuth({
    provider: 'clerk',
    publishableKey: 'pk_test_x',
    syncHost: 'https://clerk.example',
  })

  const client = await adapter.createClient()
  expect(await client.classifySession()).toBe('unconfirmed')
})
