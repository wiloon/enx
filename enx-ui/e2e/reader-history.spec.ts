import type { Locator, Page } from '@playwright/test'
import { test, expect, loginAvailable, LOGIN_SKIP_REASON } from './fixtures'

// What jsdom cannot see on /reader/history: a failed list load and a failed
// open or delete take the theme's destructive colour in light and dark mode.
// The page's behaviour is covered by the jsdom tests next to it.

test.skip(!loginAvailable, LOGIN_SKIP_REASON)

test.beforeEach(async ({ signedIn }) => {
  void signedIn
})

const documents = [
  {
    id: 'doc-1',
    createdAt: '2026-10-28T12:00:00Z',
    updatedAt: '2026-10-28T12:00:00Z',
    preview: 'A pasted note that the reader keeps for a week.',
  },
]

const failure = (message: string) => ({
  status: 500,
  contentType: 'application/json',
  body: JSON.stringify({ message }),
})

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

async function expectDestructive(page: Page, el: Locator) {
  await expect(el).toBeVisible()
  await expect
    .poll(() => el.evaluate((node) => getComputedStyle(node).color))
    .toBe(await tokenColour(page, '--destructive'))
}

for (const dark of [false, true]) {
  const mode = dark ? ' in dark mode' : ''

  test(`paints a failed list load in the destructive colour${mode}`, async ({
    page,
  }) => {
    await page.route('**/api/reader/documents', (route) =>
      route.fulfill(failure('list failed'))
    )
    await page.goto('/reader/history')
    await setDark(page, dark)

    await expectDestructive(
      page,
      page.getByRole('main').getByText(/list failed/i)
    )
  })

  test(`paints a failed delete in the destructive colour${mode}`, async ({
    page,
  }) => {
    await page.route('**/api/reader/documents', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ documents }),
      })
    )
    await page.route('**/api/reader/documents/doc-1', (route) =>
      route.fulfill(failure('delete failed'))
    )
    await page.goto('/reader/history')
    await expect(page.getByText(documents[0].preview)).toBeVisible()
    await setDark(page, dark)

    await page.getByRole('button', { name: 'Delete document' }).click()
    await expectDestructive(
      page,
      page.getByRole('main').getByText(/delete failed/i)
    )
  })
}
