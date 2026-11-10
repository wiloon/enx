import type { Page, BrowserContext } from '@playwright/test'
import { loginAvailable, LOGIN_SKIP_REASON } from './auth'
import { expect, test } from './fixtures'
import {
  feedbackPosts,
  getHighlightedWords,
  mockBackendFetch,
  wordLookupPosts,
} from './helpers'

const SHARING_KEY = 'enx-article-choice-sharing'

// null leaves the question unanswered, as on a fresh install.
async function setSharing(context: BrowserContext, value: boolean | null) {
  await context.serviceWorkers()[0].evaluate(
    async ({ key, value }) => {
      if (value === null) await chrome.storage.local.remove(key)
      else await chrome.storage.local.set({ [key]: value })
    },
    { key: SHARING_KEY, value }
  )
}

async function sharing(context: BrowserContext) {
  return context.serviceWorkers()[0].evaluate(
    async key => (await chrome.storage.local.get(key))[key],
    SHARING_KEY
  )
}

async function action(context: BrowserContext, page: Page, action: string) {
  const worker = context.serviceWorkers()[0]
  return worker.evaluate(
    async ({ url, action }) => {
      const tab = (await chrome.tabs.query({})).find(tab => tab.url === url)
      if (!tab?.id) throw new Error('Article tab not found')
      const deadline = Date.now() + 5000
      for (;;) {
        try {
          return await chrome.tabs.sendMessage(
            tab.id,
            { action },
            { frameId: 0 }
          )
        } catch (error) {
          if (
            !String(error).includes('Receiving end does not exist') ||
            Date.now() >= deadline
          )
            throw error
          await new Promise(resolve => setTimeout(resolve, 50))
        }
      }
    },
    { url: page.url(), action }
  )
}

async function pick(context: BrowserContext, page: Page, selector: string) {
  expect(await action(context, page, 'chooseArticle')).toMatchObject({
    success: true,
  })
  await page.bringToFront()
  await page.locator(selector).hover({ position: { x: 8, y: 8 } })
}

async function pointAtWord(page: Page) {
  return page.locator('#words').evaluate(root => {
    const text = root.firstChild!
    const offset = text.textContent!.indexOf('sailor')
    const range = document.createRange()
    range.setStart(text, offset)
    range.setEnd(text, offset + 6)
    const box = range.getBoundingClientRect()
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  })
}

test.describe('User-picked article', () => {
  test.skip(!loginAvailable, LOGIN_SKIP_REASON)
  test.beforeEach(async ({ context, page, signedIn: _signedIn }) => {
    await mockBackendFetch(context, {
      wordData: { Id: 'w-stub', LoadCount: 3, Known: false },
      reviewWords: [
        ['sailor', 3],
        ['fox', 1],
      ],
    })
    // Scenarios that do not exercise consent start with it answered.
    await setSharing(context, false)
    await page.goto('/article-pick.html')
  })

  test('the first pick asks before the picker starts, and with sharing off nothing leaves the extension', async ({
    context,
    page,
    extensionId,
  }) => {
    await setSharing(context, null)
    const popup = await context.newPage()
    await page.bringToFront()
    await popup.goto(`chrome-extension://${extensionId}/popup.html`)
    await popup.getByRole('button', { name: 'Choose article' }).click()
    await expect(
      popup.getByRole('region', { name: 'Share article choices?' })
    ).toBeVisible()
    await expect(page.locator('#enx-article-picker')).toHaveCount(0)

    await popup.getByRole('button', { name: "Don't share" }).click()
    await expect(page.locator('#enx-article-picker')).toBeAttached()
    expect(await sharing(context)).toBe(false)
    await page.bringToFront()
    await page.locator('#picked').hover({ position: { x: 8, y: 8 } })
    await page.mouse.down()
    await page.mouse.up()
    await expect
      .poll(() => action(context, page, 'getLearningModeStatus'))
      .toMatchObject({ status: { status: 'ready' } })
    expect(await action(context, page, 'getArticleChoice')).toMatchObject({
      choice: { source: 'your-choice', saved: true },
    })
    expect(await feedbackPosts(context)).toEqual([])
  })

  test('with sharing on, one confirmed choice sends one article_choice request with the cleaned URL and no page text', async ({
    context,
    page,
  }) => {
    await setSharing(context, true)
    await page.goto('/article-pick.html?utm_source=mail#top')
    await pick(context, page, '#picked')
    await page.mouse.down()
    await page.mouse.up()
    await expect
      .poll(() => action(context, page, 'getLearningModeStatus'))
      .toMatchObject({ status: { status: 'ready' } })
    await expect.poll(() => feedbackPosts(context)).toHaveLength(1)

    expect(await feedbackPosts(context)).toEqual([
      {
        kind: 'article_choice',
        url: new URL('/article-pick.html', page.url()).href,
        context: { adapter: 'default', extVersion: expect.any(String) },
        details: {
          selector: '[id="picked"]',
          autoSource: 'article',
          autoSelector: 'article',
        },
      },
    ])
  })

  test('choose from the popup, look up a word, retain across reload, and fall back on a page without the selector', async ({
    context,
    page,
    extensionId,
  }) => {
    const popup = await context.newPage()
    await page.bringToFront()
    await popup.goto(`chrome-extension://${extensionId}/popup.html`)
    await expect(
      popup.getByRole('button', { name: 'Choose article' })
    ).toBeVisible()
    await popup.getByRole('button', { name: 'Choose article' }).click()
    await expect(page.locator('#enx-article-picker')).toBeAttached()
    await page.bringToFront()
    await page.locator('#words').hover()
    await page.keyboard.press('ArrowUp')
    await expect(page.locator('#enx-article-picker #hint')).toContainText(
      'characters'
    )
    const expectedBox = await page.locator('#picked').boundingBox()
    const outlineBox = await page
      .locator('#enx-article-picker #outline')
      .boundingBox()
    expect(outlineBox?.width).toBeCloseTo(expectedBox!.width, 0)
    expect(outlineBox?.height).toBeCloseTo(expectedBox!.height, 0)
    await expect(page.locator('#enx-article-picker #outline')).toHaveCSS(
      'border-top-style',
      'solid'
    )
    await expect(page.locator('#enx-article-picker #outline')).toHaveCSS(
      'border-top-color',
      'oklch(0.55 0.13 200)'
    )
    await page.screenshot({ path: 'test-results/article-picker.png' })
    await page.mouse.down()
    await page.mouse.up()
    await expect
      .poll(() => action(context, page, 'getLearningModeStatus'))
      .toMatchObject({ status: { status: 'ready' } })
    expect(await wordLookupPosts(context)).toHaveLength(0)
    const point = await pointAtWord(page)
    await page.mouse.click(point.x, point.y)
    await expect(
      page.locator(
        '#enx-anchored-overlay [data-testid="word-popover-header"] h3'
      )
    ).toHaveText('sailor')
    await page.reload()
    expect(await action(context, page, 'enxRun')).toMatchObject({
      success: true,
    })
    expect(await action(context, page, 'getArticleChoice')).toMatchObject({
      choice: { source: 'your-choice', saved: true },
    })
    await page.goto('/body-paragraphs.html')
    expect(await action(context, page, 'enxRun')).toMatchObject({
      success: true,
    })
    expect(await action(context, page, 'getArticleChoice')).toMatchObject({
      choice: { source: 'automatic', saved: true, missed: true },
    })
    const fallbackPopup = await context.newPage()
    await page.bringToFront()
    await fallbackPopup.goto(`chrome-extension://${extensionId}/popup.html`)
    await expect(fallbackPopup.getByText(/could not be applied/)).toBeVisible()
    await fallbackPopup.getByRole('button', { name: 'Use automatic' }).click()
    await expect(fallbackPopup.getByText(/could not be applied/)).toHaveCount(0)
    await fallbackPopup.close()
  })

  test('a page-only replacement clears the remembered selector and reload restores automatic detection', async ({
    context,
    page,
  }) => {
    await pick(context, page, '#picked')
    await page.mouse.down()
    await page.mouse.up()
    await expect
      .poll(() => action(context, page, 'getArticleChoice'))
      .toMatchObject({ choice: { saved: true, source: 'your-choice' } })
    await page.evaluate(() => {
      document.body.innerHTML =
        '<div class="css-a1b2c3">A sailor reads this article.</div><div>A fox reads another story.</div>'
    })
    await pick(context, page, 'body > div:first-child')
    await page.mouse.down()
    await page.mouse.up()
    await expect
      .poll(() => action(context, page, 'getArticleChoice'))
      .toMatchObject({ choice: { source: 'your-choice', saved: false } })
    await page.reload()
    expect(await action(context, page, 'getArticleChoice')).toMatchObject({
      choice: { source: 'automatic', saved: false, missed: false },
    })
  })

  test('Esc restores both initial on/off states and arrows do not scroll or select body', async ({
    context,
    page,
  }) => {
    for (const initial of ['off', 'ready']) {
      if (initial === 'ready')
        expect(await action(context, page, 'enxRun')).toMatchObject({
          success: true,
        })
      await pick(context, page, '#words')
      expect(
        await action(context, page, 'getLearningModeStatus')
      ).toMatchObject({ status: { status: 'off' } })
      for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowUp')
      expect(await page.evaluate(() => scrollY)).toBe(0)
      await page.keyboard.press('Escape')
      await expect(page.locator('#enx-article-picker')).toHaveCount(0)
      await expect
        .poll(() => action(context, page, 'getLearningModeStatus'))
        .toMatchObject({ status: { status: initial } })
    }
  })

  test('multiple saved matches fall back and Use automatic preserves a disabled mode', async ({
    context,
    page,
  }) => {
    await page.evaluate(() => {
      document.querySelector('#picked')!.removeAttribute('id')
    })
    await pick(context, page, 'main')
    await page.mouse.down()
    await page.mouse.up()
    await expect
      .poll(() => action(context, page, 'getLearningModeStatus'))
      .toMatchObject({ status: { status: 'ready' } })
    await page.reload()
    await page.evaluate(() => {
      const extra = document.createElement('main')
      extra.textContent = 'Another article container'
      document.body.append(extra)
    })
    expect(await action(context, page, 'enxRun')).toMatchObject({
      success: true,
    })
    expect(await action(context, page, 'getArticleChoice')).toMatchObject({
      choice: { source: 'automatic', saved: true, missed: true },
    })
    await action(context, page, 'enxStop')
    expect(await action(context, page, 'useAutomaticArticle')).toMatchObject({
      success: true,
    })
    expect(await action(context, page, 'getLearningModeStatus')).toMatchObject({
      status: { status: 'off' },
    })
  })
  test('a manual region overrides a dedicated AWS adapter and Use automatic restores it immediately', async ({
    context,
    page,
  }) => {
    await context.route('https://docs.aws.amazon.com/**', route =>
      route.fulfill({
        contentType: 'text/html',
        body: '<style>body{font:18px/1.7 system-ui;margin:40px}main{padding:20px}</style><div id="main-col-body">The automatic fox article describes the cloud. The fox explores a long story about applications and services for readers everywhere.</div><main id="picked"><p id="words">The sailor reads another story.</p></main>',
      })
    )
    await page.goto('https://docs.aws.amazon.com/example/story.html')
    expect(await action(context, page, 'enxRun')).toMatchObject({
      success: true,
    })
    await expect
      .poll(async () =>
        (await getHighlightedWords(page)).map(word => word.text)
      )
      .toContain('fox')
    await pick(context, page, '#picked')
    await page.mouse.down()
    await page.mouse.up()
    await expect
      .poll(async () =>
        (await getHighlightedWords(page)).map(word => word.text)
      )
      .toEqual(['sailor'])
    const point = await pointAtWord(page)
    await page.mouse.click(point.x, point.y)
    await expect(
      page.locator(
        '#enx-anchored-overlay [data-testid="word-popover-header"] h3'
      )
    ).toHaveText('sailor')
    expect(await action(context, page, 'useAutomaticArticle')).toMatchObject({
      success: true,
    })
    await expect
      .poll(async () =>
        (await getHighlightedWords(page)).map(word => word.text)
      )
      .toEqual(['fox', 'fox'])
  })
  test('a manual choice starts without waiting for missing adapter content', async ({
    context,
    page,
  }) => {
    await context.route('https://docs.aws.amazon.com/**', route =>
      route.fulfill({
        contentType: 'text/html',
        body: '<style>body{font:18px/1.7 system-ui;margin:40px}main{padding:20px}</style><main id="picked"><p id="words">The sailor reads another story.</p></main>',
      })
    )
    await page.goto('https://docs.aws.amazon.com/example/missing.html')
    await pick(context, page, '#picked')
    await page.mouse.down()
    await page.mouse.up()
    await expect
      .poll(() => action(context, page, 'getLearningModeStatus'), {
        timeout: 3000,
      })
      .toMatchObject({ status: { status: 'ready' } })
  })
})
