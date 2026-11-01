import type { Locator, Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import {
  FIXTURE_ORIGIN,
  loginAvailable,
  LOGIN_SKIP_REASON,
  UI_ORIGIN,
} from './auth'
import { aiCompletionCount, clickWord, enableLearningMode } from './helpers'
import { test, expect } from './new-user'
import { zeroTrialBalance } from './seed'

const TRIAL_LINE = /^\d[\d,]* trial credits · expires /

/**
 * A word in neither `words` nor ECDICT, new on every run: the fake AI defines
 * it with quality 9, so enx-api caches the definition in `words` and a reused
 * word would never miss again. Letters only (ValidAIWord rejects digits), and
 * no English suffix a lemmatizer could strip.
 */
function newMissingWord(): string {
  const letters = [...randomBytes(10)]
    .map(byte => String.fromCharCode(97 + (byte % 26)))
    .join('')
  return `zq${letters}vq`
}

/**
 * Opens the fixture page with `word` in a sentence of its first paragraph.
 * Added at runtime: seedVocabulary writes every word on the fixture pages
 * into `words`, so a word in the HTML would never miss.
 */
async function openArticleWith(page: Page, word: string): Promise<void> {
  await page.goto('/test-page.html', { waitUntil: 'domcontentloaded' })
  await page
    .locator('article p')
    .first()
    .evaluate((paragraph, w) => {
      paragraph.append(` Everyone admired the ${w} at the meeting.`)
    }, word)
}

async function trialCredits(trial: Locator): Promise<number> {
  await expect(trial).toBeVisible()
  return Number((await trial.innerText()).split(' ')[0].replaceAll(',', ''))
}

test.describe('AI word fallback and running out of credits', () => {
  test.skip(!loginAvailable, LOGIN_SKIP_REASON)
  test.setTimeout(90_000)
  test.beforeEach(() => {
    if (!process.env.ECDICT_DB_PATH) {
      throw new Error(
        'These specs need ECDICT_DB_PATH: without ECDICT a missing word answers 503 instead of offering AI (see E2E_TESTING.md)'
      )
    }
  })

  test('a trial user looks up a word missing from the dictionary with AI and pays from the trial', async ({
    page,
    context,
    extensionId,
    newUser: _,
  }) => {
    const word = newMissingWord()
    const billing = await context.newPage()
    await billing.goto(`${UI_ORIGIN}/billing`)
    const trial = billing.getByText(TRIAL_LINE)
    const before = await trialCredits(trial)
    expect(before).toBeGreaterThan(0)
    const definitionsBefore = aiCompletionCount('word-definition')

    await openArticleWith(page, word)
    await enableLearningMode(page, extensionId)
    const popover = await clickWord(page, word)
    await popover.getByTestId('word-popover-ai-lookup').click()

    await expect(popover.getByTestId('word-popover-content')).toContainText(
      '很有魅力的人'
    )
    await expect(popover.getByTestId('word-popover-ai-badge')).toBeVisible()
    expect(aiCompletionCount('word-definition')).toBe(definitionsBefore + 1)

    await billing.reload()
    expect(await trialCredits(trial)).toBeLessThan(before)
  })

  test('a trial user out of credits gets a link to Billing instead of an AI word lookup', async ({
    page,
    extensionId,
    newUser,
  }) => {
    zeroTrialBalance(newUser.localUserId)
    const word = newMissingWord()
    const completionsBefore = aiCompletionCount()

    await openArticleWith(page, word)
    await enableLearningMode(page, extensionId)
    const popover = await clickWord(page, word)

    await expect(
      popover.getByText('Not found in the dictionary', { exact: false })
    ).toBeVisible()
    await expect(
      popover.getByTestId('word-popover-ai-upgrade')
    ).toHaveAttribute('href', `${UI_ORIGIN}/billing?src=lookup-miss`)
    await expect(
      popover.getByText('Subscribe or add credit to use AI lookup.')
    ).toBeVisible()
    await expect(popover.getByTestId('word-popover-ai-lookup')).toHaveCount(0)
    expect(aiCompletionCount()).toBe(completionsBefore)
  })

  test('a trial user out of credits sees the side panel refuse a sentence translation', async ({
    page,
    context,
    extensionId,
    newUser,
  }) => {
    zeroTrialBalance(newUser.localUserId)
    const word = newMissingWord()
    const completionsBefore = aiCompletionCount()

    await openArticleWith(page, word)
    await enableLearningMode(page, extensionId)
    const popover = await clickWord(page, word)
    await popover.getByTestId('word-popover-sentence-translation').click()
    const panel = await context.newPage()
    await panel.goto(`chrome-extension://${extensionId}/popup.html`)
    const tabId = await panel.evaluate(
      async url => (await chrome.tabs.query({ url }))[0].id!,
      `${FIXTURE_ORIGIN}/test-page.html`
    )
    await panel.goto(
      `chrome-extension://${extensionId}/sidepanel.html?tabId=${tabId}`
    )

    const error = panel.getByTestId('sidepanel-error')
    await expect(error).toContainText('Not enough AI translation credit')
    await expect(
      error.getByRole('link', { name: 'Subscribe / add credit' })
    ).toBeVisible()
    expect(aiCompletionCount()).toBe(completionsBefore)
  })
})
