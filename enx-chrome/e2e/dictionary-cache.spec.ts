import { test, expect } from './fixtures'
import { loginAvailable, LOGIN_SKIP_REASON } from './auth'
import {
  clickHighlightedWord,
  clickWord,
  dictionaryReads,
  enableLearningMode,
  mockBackendFetch,
  waitForContentScript,
  wordLookupPosts,
} from './helpers'

test.describe('Local dictionary cache (ADR-061, ADR-079)', () => {
  test.skip(!loginAvailable, LOGIN_SKIP_REASON)
  test.beforeEach(
    async ({ context, page, extensionId, signedIn: _signedIn }) => {
      await mockBackendFetch(context, {
        wordData: { Id: 'cache-word', Chinese: '缓存释义', LoadCount: 3 },
        lookupPostDelayMs: 1500,
      })
      await page.goto('/test-page.html', { waitUntil: 'domcontentloaded' })
      await enableLearningMode(page, extensionId)
      await page.bringToFront()
      await waitForContentScript(page)
    }
  )

  test('a repeat click skips the QUERY and sends one POST, displaying the definition before the count', async ({
    page,
    context,
  }) => {
    await clickHighlightedWord(page, 0)
    await expect(page.getByTitle('Looked up 4 times')).toBeVisible()
    await expect.poll(() => wordLookupPosts(context)).toHaveLength(1)
    await page.getByTestId('word-popover-close').click()
    await clickHighlightedWord(page, 0)
    await expect(page.getByText('缓存释义', { exact: true })).toBeVisible()
    await expect(page.getByTitle('Looked up 4 times')).toHaveCount(0)
    await expect
      .poll(() => wordLookupPosts(context))
      .toEqual([{ wordId: 'cache-word' }, { wordId: 'cache-word' }])
    expect(await dictionaryReads(context)).toHaveLength(1)
    await expect(page.getByTitle('Looked up 4 times')).toBeVisible()
  })

  test('a reload reuses the persisted definition', async ({
    page,
    context,
    extensionId,
  }) => {
    await clickHighlightedWord(page, 0)
    await expect.poll(() => wordLookupPosts(context)).toHaveLength(1)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await enableLearningMode(page, extensionId)
    await page.bringToFront()
    await waitForContentScript(page)
    await clickHighlightedWord(page, 0)
    await expect(page.getByText('缓存释义', { exact: true })).toBeVisible()
    await expect.poll(() => wordLookupPosts(context)).toHaveLength(2)
    expect(await dictionaryReads(context)).toHaveLength(1)
    expect((await wordLookupPosts(context))[1]).toEqual({
      wordId: 'cache-word',
    })
  })

  test('quota refusal leaves the cached definition above the upgrade notice', async ({
    page,
    context,
  }) => {
    await clickHighlightedWord(page, 0)
    await expect.poll(() => wordLookupPosts(context)).toHaveLength(1)
    await page.getByTestId('word-popover-close').click()
    await mockBackendFetch(context, {
      wordData: { Id: 'cache-word', Chinese: '缓存释义', LoadCount: 3 },
      lookupPostStatus: 429,
    })
    await clickHighlightedWord(page, 0)
    const definition = page.getByText('缓存释义', { exact: true })
    const notice = page.getByTestId('word-popover-lookup-notice')
    await expect(definition).toBeVisible()
    await expect(notice).toContainText("You've used up today's free lookups")
    await expect(notice.getByRole('link', { name: 'Upgrade' })).toBeVisible()
    const defBox = await definition.boundingBox()
    const noticeBox = await notice.boundingBox()
    expect(noticeBox!.y).toBeGreaterThanOrEqual(defBox!.y + defBox!.height)
    await page.screenshot({ path: 'test-results/dictionary-cache-quota.png' })
  })

  test('highlighted words arrive in one batch QUERY, so a click sends only the POST', async ({
    page,
    context,
  }) => {
    await expect.poll(() => dictionaryReads(context)).toHaveLength(1)
    const [batch] = (await dictionaryReads(context)) as Read[]
    expect(batch.method).toBe('QUERY')
    expect(batch.body.words).toEqual(
      expect.arrayContaining(['software', 'development', 'complex'])
    )
    expect(new Set(batch.body.words).size).toBe(batch.body.words.length)
    expect(batch.body.words).not.toContain('careful')

    await clickHighlightedWord(page, 0)
    await expect(page.getByText('缓存释义', { exact: true })).toBeVisible()
    await expect.poll(() => wordLookupPosts(context)).toHaveLength(1)
    expect(await dictionaryReads(context)).toHaveLength(1)
  })

  test('a first click on a word not highlighted reads it with one JSON QUERY', async ({
    page,
    context,
  }) => {
    await expect.poll(() => dictionaryReads(context)).toHaveLength(1)
    await clickWord(page, 'careful')
    await expect(page.getByText('缓存释义', { exact: true })).toBeVisible()
    const reads = (await dictionaryReads(context)) as Read[]
    expect(reads).toHaveLength(2)
    expect(reads[1].method).toBe('QUERY')
    expect(reads[1].body.words).toEqual(['careful'])
  })
})

type Read = { method: string; body: { words: string[] } }
