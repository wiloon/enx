import { createClerkClient } from '@clerk/backend'
import { clerk } from '@clerk/testing/playwright'
import { randomUUID } from 'node:crypto'
import { test as extensionTest, expect } from './fixtures'
import { UI_ORIGIN } from './auth'

/** A fresh external auth identity; no vocabulary or onboarding state is seeded. */
export const test = extensionTest.extend<{
  newUser: { id: string; email: string }
}>({
  newUser: async ({ context, extensionId, clerkTesting: _ }, use, testInfo) => {
    const secretKey = process.env.CLERK_SECRET_KEY
    if (!secretKey?.startsWith('sk_test_')) {
      throw new Error(
        'newUser requires a Clerk development instance secret key'
      )
    }
    const client = createClerkClient({ secretKey })
    const email = `e2e-new-${randomUUID()}+clerk_test@example.com`
    const { id } = await client.users.createUser({ emailAddress: [email] })
    try {
      const site = await context.newPage()
      await site.goto(`${UI_ORIGIN}/welcome?src=install`)
      await clerk.signIn({ page: site, emailAddress: email })
      const popup = await context.newPage()
      await popup.goto(`chrome-extension://${extensionId}/popup.html`)
      await expect(async () => {
        const result = await popup.evaluate(() =>
          chrome.runtime.sendMessage({ type: 'validateSession' })
        )
        expect(result?.success, JSON.stringify(result)).toBe(true)
      }).toPass({ timeout: 30_000 })
      await popup.close()
      await site.close()
      await use({ id, email })
    } finally {
      await client.users.deleteUser(id)
      const { data, totalCount } = await client.users.getUserList({
        userId: [id],
      })
      expect(data, 'temporary Clerk user must no longer exist').toEqual([])
      expect(totalCount).toBe(0)
      await testInfo.attach('clerk-user-cleanup', {
        body: JSON.stringify({ id, deleted: true, remaining: totalCount }),
        contentType: 'application/json',
      })
    }
  },
})

export { expect } from './fixtures'
