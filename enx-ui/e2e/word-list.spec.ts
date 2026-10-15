import { test, expect, loginAvailable, LOGIN_SKIP_REASON } from './fixtures'
import type { WordListEntry } from '@/types'

// What jsdom cannot see on /words: the row's "⋯" menu stays out of sight
// until the row is hovered or the menu button has keyboard focus, and a long
// definition is cut to two lines until the word is opened. The rest of the
// page's behaviour is covered by the jsdom tests next to the page.

const word = (
  english: string,
  queryCount: number,
  known = false,
  chinese = 'n. 示例释义'
) =>
  ({
    english,
    chinese,
    pronunciation: '',
    queryCount,
    known,
    firstLookedUpAt: '2026-10-01T09:00:00Z',
    lastLookedUpAt: '2026-10-12T09:00:00Z',
  }) satisfies WordListEntry

const words = [
  word('consolidate', 6, false, 'vt. 巩固\nvi. 联合\n[经] 合并\n[计] 整理'),
  word('reinforce', 3),
  word('moments', 1),
  word('intersection', 12),
  word('eligibility', 25),
  word('flex', 4, true),
]

test.skip(!loginAvailable, LOGIN_SKIP_REASON)

test.beforeEach(async ({ page, signedIn }) => {
  void signedIn
  await page.route('**/api/me/words**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, total: words.length, words }),
    })
  )
  await page.goto('/words')
  await expect(page.getByText('consolidate')).toBeVisible()
})

test('shows a row’s menu only while the row is hovered', async ({ page }) => {
  const menu = page.getByRole('button', {
    name: 'More actions for consolidate',
  })
  await expect(menu).toHaveCSS('opacity', '0')

  await page.getByText('consolidate').hover()
  await expect(menu).toHaveCSS('opacity', '1')

  await page.getByRole('heading', { name: 'Word List', level: 1 }).hover()
  await expect(menu).toHaveCSS('opacity', '0')
})

test('shows the menu button when it has keyboard focus', async ({ page }) => {
  const menu = page.getByRole('button', {
    name: 'More actions for consolidate',
  })
  // Tab from the word's own button to its menu button.
  await page.getByRole('button', { name: /^consolidate/ }).focus()
  await page.keyboard.press('Tab')
  await expect(menu).toBeFocused()
  await expect(menu).toHaveCSS('opacity', '1')
})

test('cuts a long definition to two lines until the word is opened', async ({
  page,
}) => {
  const definition = page.getByText('vt. 巩固', { exact: false })
  const lineHeight = await definition.evaluate((el) =>
    parseFloat(getComputedStyle(el).lineHeight)
  )
  const lines = async () =>
    Math.round((await definition.boundingBox())!.height / lineHeight)
  expect(await lines()).toBe(2)

  await page.getByRole('button', { name: /^consolidate/ }).click()

  await expect.poll(lines).toBe(4)
})
