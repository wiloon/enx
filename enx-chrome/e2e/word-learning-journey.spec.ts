import type { Page } from '@playwright/test'
import { loginAvailable, LOGIN_SKIP_REASON, UI_ORIGIN } from './auth'
import { expect, test } from './fixtures'
import {
  clickHighlightedWord,
  enableLearningMode,
  getHighlightedWords,
  isWordHighlighted,
  waitForContentScript,
} from './helpers'
import { seededChinese } from './seed'

// This fixture word is not marked known by another spec. signedIn seeds its
// dictionary entry and review state in the disposable database on every run.
const word = 'productivity'

async function displayedLookups(site: Page): Promise<number> {
  const loaded = site.waitForResponse(
    response =>
      response.url().includes('/api/stats/series?') && response.status() === 200
  )
  await site.goto(`${UI_ORIGIN}/stats`)
  await loaded
  await expect(
    site.getByRole('heading', { name: 'Reading Stats' })
  ).toBeVisible()
  await expect(
    site.getByRole('img', { name: 'words over time', exact: true })
  ).toBeVisible()
  // /stats sums the selected window, rather than showing a separate today
  // counter. Compare the rendered value, never an API/SQL side channel.
  const value = site
    .getByText('Words looked up', { exact: true })
    .locator('..')
    .locator('div')
    .last()
  await expect(value).toHaveText(/^\d[\d,]*$/)
  return Number((await value.innerText()).replaceAll(',', ''))
}

async function searchWords(site: Page, status: 'Learning' | 'Known') {
  await site.goto(`${UI_ORIGIN}/words`)
  await site.getByRole('searchbox', { name: 'Search words' }).fill(word)
  const loaded = site.waitForResponse(response => {
    const url = new URL(response.url())
    return (
      url.pathname === '/api/me/words' &&
      url.searchParams.get('q') === word &&
      url.searchParams.get('status') === status.toLowerCase() &&
      response.status() === 200
    )
  })
  await site.getByRole('button', { name: status, exact: true }).click()
  await loaded
}

test.describe('A word across the article, Word List and Reading Stats', () => {
  test.skip(!loginAvailable, LOGIN_SKIP_REASON)

  test('a lookup is counted and marking it known updates the website and article', async ({
    context,
    page,
    extensionId,
    signedIn: _signedIn,
  }) => {
    test.setTimeout(90_000)
    const site = await context.newPage()
    const before = await displayedLookups(site)

    await page.goto('/typescript-page.html', { waitUntil: 'domcontentloaded' })
    await enableLearningMode(page, extensionId)
    await page.bringToFront()
    await waitForContentScript(page)
    const words = await getHighlightedWords(page)
    const index = words.findIndex(entry => entry.text.toLowerCase() === word)
    expect(
      index,
      `${word} must start underlined for review`
    ).toBeGreaterThanOrEqual(0)
    expect((await clickHighlightedWord(page, index)).toLowerCase()).toBe(word)
    const popover = page.locator('#enx-anchored-overlay')
    await expect(
      popover.getByText(seededChinese(word), { exact: true })
    ).toBeVisible()

    await searchWords(site, 'Learning')
    await expect(
      site.getByRole('listitem').filter({ hasText: seededChinese(word) })
    ).toBeVisible()
    expect(await displayedLookups(site)).toBe(before + 1)

    await page.bringToFront()
    await popover.getByRole('button', { name: /Know It/ }).click()
    await expect(popover).toHaveCount(0)
    await expect.poll(() => isWordHighlighted(page, word)).toBe(false)

    await searchWords(site, 'Learning')
    await expect(
      site.getByRole('listitem').filter({ hasText: seededChinese(word) })
    ).toHaveCount(0)
    await searchWords(site, 'Known')
    const knownRow = site
      .getByRole('listitem')
      .filter({ hasText: seededChinese(word) })
    await expect(knownRow).toBeVisible()
    await expect(knownRow.getByText('Known', { exact: true })).toBeVisible()
    await expect.poll(() => isWordHighlighted(page, word)).toBe(false)
  })
})
