import { test, expect, loginAvailable, LOGIN_SKIP_REASON } from './fixtures'
import type { WordData } from '@/types'

// What jsdom cannot see on /lookup: the word id is a one-line footnote that
// gives way (truncates) on a phone instead of wrapping or widening the page.
// The card's behaviour is covered by the jsdom tests next to it.

const scratchpad: WordData = {
  Id: '05d676fb-556e-4dc2-963c-4bfc2560a913',
  Key: 'scratchpad',
  English: 'scratchpad',
  Pronunciation: "'skrætʃpæd",
  Chinese: '便签簿,中间结果暂存器',
  LoadCount: 0,
  Known: false,
  WordType: 0,
}

test.skip(!loginAvailable, LOGIN_SKIP_REASON)

test.beforeEach(async ({ page, signedIn }) => {
  void signedIn
  await page.route('**/api/word/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(scratchpad),
    })
  )
})

test('keeps the word id on one line on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 })
  await page.goto('/lookup')
  await page.getByLabel('Enter English word').fill('scratchpad')
  await page.getByRole('button', { name: 'Look Up' }).click()

  const id = page.getByText(`ID ${scratchpad.Id}`)
  await expect(id).toBeVisible()
  const box = await id.boundingBox()
  const lineHeight = await id.evaluate((el) =>
    parseFloat(getComputedStyle(el).lineHeight)
  )
  expect(box!.height).toBeLessThanOrEqual(lineHeight + 1)

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  )
  expect(overflow).toBeLessThanOrEqual(0)
})
