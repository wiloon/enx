// ADR-095 / #1187: a browser that never signed in turns learning mode on and
// looks a word up with no account. The fixture profile is fresh, so it has no
// Clerk session and no "signed in before" flag.

import { test, expect } from './fixtures'
import { FIXTURE_ORIGIN } from './auth'
import { clickWord, enableLearningMode } from './helpers'
import { seedWords, seededChinese } from './seed'

const SAVE_PROMPT = 'Sign in to save this word and see it underlined next time.'

type Call = { url: string; headers: Record<string, string> }

test('looks a word up without an account', async ({
  context,
  extensionId,
  page,
}) => {
  seedWords()

  // Every request the worker makes, with its headers.
  let [worker] = context.serviceWorkers()
  if (!worker) worker = await context.waitForEvent('serviceworker')
  await worker.evaluate(() => {
    const scope = self as unknown as { __calls: Call[] }
    scope.__calls = []
    const original = self.fetch.bind(self)
    self.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      scope.__calls.push({
        url: String(input instanceof Request ? input.url : input),
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
      })
      return original(input, init)
    }
  })

  await page.goto(`${FIXTURE_ORIGIN}/test-page.html`)
  await enableLearningMode(page, extensionId)

  const popover = await clickWord(page, 'complex')
  await expect(popover.getByTestId('word-popover-content')).toContainText(
    seededChinese('complex')
  )
  await expect(popover.getByTestId('word-popover-anonymous')).toContainText(
    SAVE_PROMPT
  )
  await expect(
    popover.getByTestId('word-popover-anonymous-sign-in')
  ).toBeVisible()
  await expect(popover.getByTestId('word-popover-mark-known')).toHaveCount(0)

  const calls = await worker.evaluate(
    () => (self as unknown as { __calls: Call[] }).__calls
  )
  const lookups = calls.filter(call =>
    call.url.endsWith('/api/anonymous/dictionary/entry')
  )
  expect(lookups).toHaveLength(1)
  expect(lookups[0].headers['x-enx-device-id']).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
  )
  for (const call of calls) {
    expect(call.headers, call.url).not.toHaveProperty('authorization')
  }
})
