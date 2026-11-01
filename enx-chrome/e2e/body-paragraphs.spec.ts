// #565: on a page whose paragraphs sit directly under <body> (a Gutenberg
// book, an RFC, a Paul Graham essay), body is the article root, so a word in
// those paragraphs is clickable. The fixture is hand-written, not a real page.

import { loginAvailable, LOGIN_SKIP_REASON } from './auth'
import { expect, test } from './fixtures'
import {
  clickWord,
  enableLearningMode,
  mockBackendFetch,
  wordLookupPosts,
} from './helpers'

test.describe('Paragraphs directly under body', () => {
  // ADR-037: a real Clerk session; skipped (not faked) without credentials.
  test.skip(!loginAvailable, LOGIN_SKIP_REASON)

  test('a word opens the popover, and a click inside the popover looks nothing up', async ({
    context,
    page,
    extensionId,
    signedIn: _signedIn,
  }) => {
    await mockBackendFetch(context, {
      wordData: { Id: 'w-stub', LoadCount: 3, Known: false },
    })
    await page.goto('/body-paragraphs.html', { waitUntil: 'domcontentloaded' })
    await enableLearningMode(page, extensionId)

    const popover = await clickWord(page, 'sailor', 'body > p')
    await expect(
      popover.locator('[data-testid="word-popover-header"] h3')
    ).toHaveText('sailor')
    await expect.poll(() => wordLookupPosts(context)).toHaveLength(1)
    await popover.evaluate(el => el.setAttribute('data-e2e-marker', 'first'))

    // The overlay's shadow host sits under body, so this click reaches the
    // body root's click listener too.
    await popover.locator('[data-testid="word-popover-header"] h3').click()
    await page.waitForTimeout(500)

    expect(await wordLookupPosts(context)).toHaveLength(1)
    await expect(popover).toHaveAttribute('data-e2e-marker', 'first')
  })
})

// The geometry ReadingSession.noteScroll handles for a body root: the box is
// one viewport tall and scrollHeight is where the overflowing text ends.
test('a 100%-height body box is viewport tall while its paragraphs overflow it', async ({
  page,
}) => {
  await page.goto('/body-paragraphs.html', { waitUntil: 'domcontentloaded' })

  const geometry = await page.evaluate(() => {
    const body = document.body
    const paragraphs = body.querySelectorAll(':scope > p')
    const lastBottom =
      paragraphs[paragraphs.length - 1].getBoundingClientRect().bottom
    return {
      viewport: window.innerHeight,
      boxHeight: body.getBoundingClientRect().height,
      scrollHeight: body.scrollHeight,
      textBottom: lastBottom - body.getBoundingClientRect().top,
    }
  })

  expect(geometry.boxHeight).toBe(geometry.viewport)
  expect(geometry.textBottom).toBeGreaterThan(2 * geometry.viewport)
  expect(geometry.scrollHeight).toBeGreaterThanOrEqual(
    Math.floor(geometry.textBottom)
  )
})
