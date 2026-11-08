// AWS docs render the article column #main-col-body by script after load.
// Learning mode turned on before the column exists waits for the adapter's
// readySelector, so the column becomes the article instead of the whole page
// (#724). The fixture inserts the column only after enxRun has reached the
// content script.

import path from 'path'
import { fileURLToPath } from 'url'
import { loginAvailable, LOGIN_SKIP_REASON } from './auth'
import { expect, test } from './fixtures'
import { enableLearningMode, mockBackendFetch } from './helpers'

const FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'test-fixtures',
  'aws-docs-lambda.html'
)
const PAGE = 'https://docs.aws.amazon.com/lambda/latest/dg/welcome.html'

test.describe('AWS docs article column rendered after load', () => {
  // ADR-037: a real Clerk session; skipped (not faked) without credentials.
  test.skip(!loginAvailable, LOGIN_SKIP_REASON)

  test('learning mode turned on before the column exists makes the column the article', async ({
    context,
    page,
    extensionId,
    signedIn: _signedIn,
  }) => {
    await context.route('https://docs.aws.amazon.com/**', route =>
      route.request().url() === PAGE
        ? route.fulfill({
            path: FIXTURE,
            contentType: 'text/html; charset=utf-8',
          })
        : route.fulfill({ status: 404 })
    )
    await mockBackendFetch(context, {
      wordData: { Id: 'w-stub', LoadCount: 3, Known: false },
      reviewWords: [],
    })
    await page.goto(PAGE, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('#main-col-body')).toHaveCount(0)

    // Throws unless enxRun succeeds.
    await enableLearningMode(page, extensionId)

    await page.bringToFront()
    const column = page.locator('#main-col-body p')
    await column.scrollIntoViewIfNeeded()
    const point = await column.evaluate(root => {
      const word = 'serverless'
      const text = root.firstChild!
      const offset = text.textContent!.indexOf(word)
      const range = document.createRange()
      range.setStart(text, offset)
      range.setEnd(text, offset + word.length)
      const box = range.getBoundingClientRect()
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    })
    await page.mouse.click(point.x, point.y)

    await expect(
      page.locator(
        '#enx-anchored-overlay [data-testid="word-popover-header"] h3'
      )
    ).toHaveText('serverless')
  })
})
