import type { Page } from '@playwright/test'
import { test, expect, loginAvailable, LOGIN_SKIP_REASON } from './fixtures'
import type { WordData } from '@/types'

// What jsdom cannot see on /lookup: the word id is a one-line footnote that
// gives way (truncates) on a phone instead of wrapping or widening the page,
// a translation's line breaks show as separate lines, and Look Up looks
// pressed while held. The card's behaviour is covered by the jsdom tests next
// to it.

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

test.beforeEach(async ({ signedIn }) => {
  void signedIn
})

// Looks the word up with the API mocked; returns the bodies of the
// POST /api/me/word-lookups the page sent, so no request reaches a real API.
async function lookUp(page: Page, word: WordData) {
  const recorded: unknown[] = []
  await page.route('**/api/word/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(word),
    })
  )
  await page.route('**/api/me/word-lookups', (route) => {
    recorded.push(route.request().postDataJSON())
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ queryCount: word.LoadCount + 1, known: false }),
    })
  })
  await page.goto('/lookup')
  await page.getByLabel('Enter English word').fill(word.English)
  await page.getByRole('button', { name: 'Look Up' }).click()
  return recorded
}

const lineHeightOf = (el: Element) =>
  parseFloat(getComputedStyle(el).lineHeight)

// Lines of text in an element: its content height, padding left out, over
// its line height.
const linesOf = (el: Element) => {
  const style = getComputedStyle(el)
  const content =
    el.getBoundingClientRect().height -
    parseFloat(style.paddingTop) -
    parseFloat(style.paddingBottom)
  return Math.round(content / parseFloat(style.lineHeight))
}

test('keeps the word id on one line on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 })
  await lookUp(page, scratchpad)

  const id = page.getByText(`ID ${scratchpad.Id}`)
  await expect(id).toBeVisible()
  const box = await id.boundingBox()
  expect(box!.height).toBeLessThanOrEqual((await id.evaluate(lineHeightOf)) + 1)

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  )
  expect(overflow).toBeLessThanOrEqual(0)
})

test('shows each line of a translation on its own line', async ({ page }) => {
  // ECDICT separates parts of speech with line breaks.
  await lookUp(page, { ...scratchpad, Chinese: 'n. 便签簿\nn. 中间结果暂存器' })

  const translation = page.getByText('n. 便签簿')
  await expect(translation).toBeVisible()
  expect(await translation.evaluate(linesOf)).toBe(2)
})

test('records the lookup once, by the word id the lookup answered with', async ({
  page,
}) => {
  const recorded = await lookUp(page, scratchpad)

  await expect(page.getByTitle('Looked up 1 time')).toBeVisible()
  expect(recorded).toEqual([{ wordId: scratchpad.Id }])
})

test('shows Look Up pressed while the mouse is held down on it', async ({
  page,
}) => {
  await page.goto('/lookup')
  const button = page.getByRole('button', { name: 'Look Up' })
  const pressed = () =>
    button.evaluate((el) => {
      const style = getComputedStyle(el)
      return { scale: style.scale, filter: style.filter }
    })

  // The input is empty, so releasing the button submits no lookup.
  await button.hover()
  await page.mouse.down()
  await expect
    .poll(pressed)
    .toEqual({ scale: '0.97', filter: 'brightness(0.9)' })

  await page.mouse.up()
  await expect.poll(pressed).toEqual({ scale: 'none', filter: 'none' })
})
