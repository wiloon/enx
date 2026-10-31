import type { Page } from '@playwright/test'
import { test, expect, loginAvailable, LOGIN_SKIP_REASON } from './fixtures'

// What jsdom cannot see on /reader: the paste page fits a phone, and the
// primary action, the missing-extension warning and a failed save take the
// theme's colours in light and dark mode. The page's behaviour is covered by
// the jsdom tests next to it.

test.skip(!loginAvailable, LOGIN_SKIP_REASON)

test.beforeEach(async ({ signedIn }) => {
  void signedIn
})

const documents = [1, 2, 3].map((n) => ({
  id: `doc-${n}`,
  createdAt: '2026-10-28T12:00:00Z',
  updatedAt: '2026-10-28T12:00:00Z',
  preview: `A pasted note number ${n} that the reader keeps for a week.`,
}))

// Opens /reader with the API mocked: the list answers, a save fails.
async function openReader(page: Page) {
  await page.route('**/api/reader/documents', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ documents }),
        })
      : route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'save failed' }),
        })
  )
  await page.goto('/reader')
  await expect(page.getByText(documents[0].preview)).toBeVisible()
  await expect(
    page.getByText(/Reader needs the Catglish Chrome extension/)
  ).toBeVisible()
}

const setDark = (page: Page, dark: boolean) =>
  page.evaluate(
    (on) => document.documentElement.classList.toggle('dark', on),
    dark
  )

// The colour a theme token paints, resolved by the browser the same way it
// resolves the element's own colour.
const tokenColour = (page: Page, token: string) =>
  page.evaluate((t) => {
    const probe = document.createElement('span')
    probe.style.color = `var(${t})`
    document.body.appendChild(probe)
    const colour = getComputedStyle(probe).color
    probe.remove()
    return colour
  }, token)

const sidewaysOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)

test('the paste page fits a phone with Start reading on screen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 800 })
  await openReader(page)

  await expect(
    page.getByRole('button', { name: 'Start reading' })
  ).toBeInViewport()
  expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0)
})

for (const dark of [false, true]) {
  test(`paints the primary action, the warning and a failed save in the theme colours${dark ? ' in dark mode' : ''}`, async ({
    page,
  }) => {
    await openReader(page)
    await setDark(page, dark)

    // Polled: buttons transition their colours after the theme switches.
    const start = page.getByRole('button', { name: 'Start reading' })
    await expect
      .poll(() => start.evaluate((el) => getComputedStyle(el).backgroundColor))
      .toBe(await tokenColour(page, '--brand'))

    const warning = page.getByRole('note')
    await expect
      .poll(() => warning.evaluate((el) => getComputedStyle(el).color))
      .toBe(await tokenColour(page, '--warning-foreground'))

    await page
      .getByLabel('Paste English text')
      .fill('A note that will not save.')
    await start.click()
    const failed = page.getByText("Couldn't save (still readable)")
    await expect(failed).toBeVisible()
    await expect
      .poll(() => failed.evaluate((el) => getComputedStyle(el).color))
      .toBe(await tokenColour(page, '--destructive'))
  })
}
