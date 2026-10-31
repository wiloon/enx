import type { Page } from '@playwright/test'
import { loginAvailable, LOGIN_SKIP_REASON, UI_ORIGIN } from './auth'
import { expect, test } from './fixtures'
import {
  clickHighlightedWord,
  getHighlightedWords,
  isWordHighlighted,
} from './helpers'
import { seededChinese } from './seed'

// ADR-019: the paste-text reader is where a website asks the extension to
// start learning mode (`enx:enable-reader`), instead of the toolbar popup.

const SAVED = 'Saved · kept for 7 days'

/** Opens /reader once the extension is ready to hear the page. */
async function openReader(page: Page, extensionId: string) {
  await page.goto(`${UI_ORIGIN}/reader`)
  const configuredId = await page.evaluate(
    () =>
      (window as unknown as { __ENX_ENV__?: { ENX_EXTENSION_ID?: string } })
        .__ENX_ENV__?.ENX_EXTENSION_ID ?? ''
  )
  expect(
    configuredId,
    'enx-ui must serve the loaded extension ID in __ENX_ENV__ (playwright.config.ts sets ENX_EXTENSION_ID; a reused enx-ui server may lack it)'
  ).toBe(extensionId)
  // The content module stamps this and registers its message listener in
  // the same synchronous evaluation, so the page's request cannot be lost.
  await expect(page.locator('html')).toHaveAttribute('data-enx-extension', /.+/)
}

/** Pastes `text` into the reader and submits it through Start reading. */
async function readPastedText(page: Page, text: string) {
  const pasteBox = page.getByLabel('Paste English text')
  const startReading = page.getByRole('button', { name: 'Start reading' })
  // Before hydration a fill lands in the DOM but not in React's state.
  await expect(async () => {
    await pasteBox.fill(text)
    await expect(startReading).toBeEnabled({ timeout: 1_000 })
  }).toPass({ timeout: 15_000 })
  await startReading.click()
}

test.describe('Paste-text reader with the extension', () => {
  test.skip(!loginAvailable, LOGIN_SKIP_REASON)
  test.setTimeout(90_000)

  test('the page turns on learning mode, and a seeded word looks up and the text saves', async ({
    page,
    extensionId,
    signedIn: _signedIn,
  }) => {
    const word = 'productivity'
    await openReader(page, extensionId)
    await readPastedText(
      page,
      `Remote teams often measure productivity by the work they finish, not by the hours they spend online.`
    )

    await expect
      .poll(() => isWordHighlighted(page, word), {
        message: `${word} must be highlighted after the page asks for learning mode`,
        timeout: 15_000,
      })
      .toBe(true)
    const words = await getHighlightedWords(page)
    const index = words.findIndex(entry => entry.text.toLowerCase() === word)
    expect((await clickHighlightedWord(page, index)).toLowerCase()).toBe(word)
    await expect(
      page
        .locator('#enx-anchored-overlay')
        .getByText(seededChinese(word), { exact: true })
    ).toBeVisible()

    await expect(page.getByText(SAVED, { exact: true })).toBeVisible()
  })

  test('My Documents lists the newly saved text with its preview and update time', async ({
    page,
    extensionId,
    signedIn: _signedIn,
  }) => {
    const marker = `marker${Date.now().toString(36)}${test.info().repeatEachIndex}`
    const text = `History check ${marker}: a short note that the reader keeps for a week.`

    // The list as it was before the save: an empty list counts too.
    const initialList = page.waitForResponse(
      response =>
        new URL(response.url()).pathname === '/api/reader/documents' &&
        response.request().method() === 'GET' &&
        response.ok()
    )
    await openReader(page, extensionId)
    await (await initialList).body()

    const before = await page.evaluate(() => Date.now())
    await readPastedText(page, text)
    await expect(page.getByText(SAVED, { exact: true })).toBeVisible()
    const after = await page.evaluate(() => Date.now())

    // Client-side navigation: the reader's cached list is what this page reads.
    await page.getByRole('link', { name: 'My Documents' }).click()
    await expect(page).toHaveURL(`${UI_ORIGIN}/reader/history`)
    await expect(
      page.getByRole('heading', { name: 'My Documents' })
    ).toBeVisible()

    const row = page.getByRole('listitem').filter({ hasText: marker })
    await expect(row).toHaveCount(1)
    await expect(row.getByText(text, { exact: true })).toBeVisible()

    const shown = await row
      .getByRole('button')
      .first()
      .locator('span')
      .last()
      .innerText()
    // Every locale string the browser would render for a time around the
    // save, allowing a second either side for the server's precision.
    const expected = await page.evaluate(
      ({ from, to }) => {
        const times = new Set<string>()
        const start = Math.floor(from / 1000) * 1000 - 1000
        for (let t = start; t <= to + 1000; t += 1000) {
          times.add(new Date(t).toLocaleString())
        }
        return [...times]
      },
      { from: before, to: after }
    )
    expect(expected).toContain(shown)
  })
})
