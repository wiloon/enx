import { createClerkClient } from '@clerk/backend'
import { clerk } from '@clerk/testing/playwright'
import type { TestInfo } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { test as extensionTest, expect } from './fixtures'
import { UI_ORIGIN } from './auth'

/** A fresh external auth identity; no vocabulary or onboarding state is seeded. */
export type FreshUser = { id: string; email: string }

export type FreshUsers = {
  /**
   * Creates a Clerk user without signing it in; sign in with `clerk.signIn`
   * on a website page. Every user created is deleted after the test.
   */
  create: () => Promise<FreshUser>
}

type ClerkClient = ReturnType<typeof createClerkClient>

/**
 * Deletes every user and verifies it is gone, carrying on past failures.
 * Attaches one `clerk-user-cleanup` result per user; returns the errors.
 */
async function deleteUsers(
  client: ClerkClient,
  ids: readonly string[],
  testInfo: TestInfo
): Promise<string[]> {
  const errors: string[] = []
  for (const id of ids) {
    const result: Record<string, unknown> = { id }
    try {
      await client.users.deleteUser(id)
      result.deleted = true
    } catch (err) {
      result.deleted = false
      result.deleteError = String(err)
      errors.push(`delete ${id}: ${String(err)}`)
    }
    try {
      const { data, totalCount } = await client.users.getUserList({
        userId: [id],
      })
      result.remaining = totalCount
      if (data.length !== 0 || totalCount !== 0) {
        errors.push(`temporary Clerk user ${id} must no longer exist`)
      }
    } catch (err) {
      result.verifyError = String(err)
      errors.push(`verify ${id}: ${String(err)}`)
    }
    await testInfo.attach('clerk-user-cleanup', {
      body: JSON.stringify(result),
      contentType: 'application/json',
    })
  }
  return errors
}

export const test = extensionTest.extend<{
  freshUsers: FreshUsers
  newUser: FreshUser
}>({
  freshUsers: async ({ clerkTesting: _ }, use, testInfo) => {
    const secretKey = process.env.CLERK_SECRET_KEY
    if (!secretKey?.startsWith('sk_test_')) {
      throw new Error(
        'freshUsers requires a Clerk development instance secret key'
      )
    }
    const client = createClerkClient({ secretKey })
    const created: string[] = []
    await use({
      create: async () => {
        const email = `e2e-new-${randomUUID()}+clerk_test@example.com`
        const { id } = await client.users.createUser({ emailAddress: [email] })
        created.push(id)
        return { id, email }
      },
    })
    const errors = await deleteUsers(client, created, testInfo)
    if (errors.length > 0) {
      throw new Error(`Clerk user cleanup failed:\n${errors.join('\n')}`)
    }
  },

  /** One fresh user, signed in on the website and synced into the extension. */
  newUser: async ({ context, extensionId, freshUsers }, use) => {
    const user = await freshUsers.create()
    const site = await context.newPage()
    await site.goto(`${UI_ORIGIN}/welcome?src=install`)
    await clerk.signIn({ page: site, emailAddress: user.email })
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
    await use(user)
  },
})

export { expect } from './fixtures'
