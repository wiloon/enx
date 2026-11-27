import { expect, test } from './fixtures'
import { loginAvailable, LOGIN_SKIP_REASON } from './auth'
import {
  clickWordAndWaitForPopup,
  enableLearningMode,
  mockBackendFetch,
  waitForContentScript,
} from './helpers'

// ADR-098: in a short viewport, whole English senses are dropped from the
// end so the header and actions stay in view. At least one sense remains;
// anything still overflowing scrolls as today.

const ENGLISH_SENSES = [
  {
    pos: 'n',
    gloss: 'A greeting used when meeting someone.',
    example: 'Hello, everyone.',
  },
  {
    pos: 'n',
    gloss: 'An expression of goodwill on parting.',
    example: 'Hello and goodbye.',
  },
  {
    pos: 'intj',
    gloss: 'Used to attract attention.',
    example: 'Hello! Is anyone there?',
  },
  {
    pos: 'intj',
    gloss: 'Used to answer a telephone.',
    example: 'Hello? Who is calling?',
  },
]

test.describe('English-English popover senses in a short viewport', () => {
  test.skip(!loginAvailable, LOGIN_SKIP_REASON)

  test('drops whole senses from the end while keeping header and actions', async ({
    context,
    page,
    extensionId,
    signedIn: _signedIn,
  }) => {
    await page.setViewportSize({ width: 1280, height: 280 })
    await mockBackendFetch(context, {
      explanationLanguage: 'en',
      wordData: {
        Id: 'w-hello',
        English: 'hello',
        Chinese: '',
        Pronunciation: '',
        ExplanationLanguage: 'en',
        Origin: 'wiktionary',
        PronunciationUS: '/həˈloʊ/',
        PronunciationUK: '/həˈləʊ/',
        LemmaNote: undefined,
        Senses: ENGLISH_SENSES,
        LoadCount: 1,
        Known: false,
      },
    })
    await page.goto('/test-page.html', { waitUntil: 'domcontentloaded' })
    await enableLearningMode(page, extensionId)
    await page.bringToFront()
    await waitForContentScript(page)

    await clickWordAndWaitForPopup(page, 0)
    const popover = page.locator('#enx-anchored-overlay')
    const header = popover.getByTestId('word-popover-header')
    const actions = popover.getByTestId('word-popover-sentence-translation')
    const senses = popover.getByTestId('word-popover-sense')

    await expect(header).toBeVisible()
    await expect(actions).toBeVisible()
    await expect(popover.getByTestId('word-popover-senses')).toBeVisible()

    const senseCount = await senses.count()
    expect(senseCount).toBeGreaterThanOrEqual(1)
    // P-5 / issue: a short viewport must drop at least one whole sense.
    expect(senseCount).toBeLessThan(ENGLISH_SENSES.length)

    const headerBox = await header.boundingBox()
    const actionsBox = await actions.boundingBox()
    const viewport = page.viewportSize()!
    expect(headerBox).not.toBeNull()
    expect(actionsBox).not.toBeNull()
    expect(headerBox!.y).toBeGreaterThanOrEqual(0)
    expect(actionsBox!.y + actionsBox!.height).toBeLessThanOrEqual(
      viewport.height
    )

    // With a short viewport the floating UI caps the overlay; some senses
    // may be clipped inside the scrollable content while header and actions
    // stay fully in view.
    const content = popover.getByTestId('word-popover-content')
    const contentBox = await content.boundingBox()
    expect(contentBox).not.toBeNull()
    const overflowY = await content.evaluate(
      el => getComputedStyle(el).overflowY
    )
    expect(['auto', 'scroll', 'overlay', 'hidden']).toContain(overflowY)
  })
})
