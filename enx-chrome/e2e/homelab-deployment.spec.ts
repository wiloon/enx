import type { Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { TARGETS } from '../src/config/targets'
import { EXTENSION_ID, loginAvailable } from './auth'
import { expect, test } from './fixtures'
import { clickWord, enableLearningMode, openPopup } from './helpers'

/**
 * The HomeLab lane (ADR-037 Decision 6): run by hand before the internal beta
 * and before a release, against the deployed HomeLab with the dist-homelab
 * build. It checks only what the local stack cannot see: deployed config and
 * secrets, ingress and TLS, the real extension ID and its CORS, the
 * production-style images. It writes to the HomeLab database as the e2e user.
 *
 *   pnpm build && pnpm test:e2e:homelab      # see E2E_TESTING.md
 */

const API = TARGETS.homelab.apiBaseUrl
const SITE = TARGETS.homelab.frontendBaseUrl
const WORD = 'reliable'

/** The newest first-parent commit on origin/main that touched enx-api. */
function mainApiCommit(): string {
  try {
    return execFileSync(
      'git',
      [
        'log',
        '-1',
        '--first-parent',
        '--format=%H',
        'origin/main',
        '--',
        ':(top)enx-api',
      ],
      { encoding: 'utf8' }
    ).trim()
  } catch {
    return ''
  }
}

/**
 * The lookup count `/words` shows on the exact row for WORD, or 0 when the
 * search finds no such row. Loads the page afresh on every call.
 */
async function wordLookups(site: Page): Promise<number> {
  await site.goto(`${SITE}/words`)
  const loaded = site.waitForResponse(response => {
    const url = new URL(response.url())
    return (
      url.pathname === '/api/me/words' &&
      url.searchParams.get('q') === WORD &&
      response.status() === 200
    )
  })
  await site.getByRole('searchbox', { name: 'Search words' }).fill(WORD)
  const listed = (await (await loaded).json()) as {
    words: { english: string }[]
  }
  const row = site
    .getByRole('listitem')
    .filter({ has: site.getByText(WORD, { exact: true }) })
  if (!listed.words.some(word => word.english === WORD)) {
    await expect(row).toHaveCount(0)
    return 0
  }
  const label = row.getByText(/^Looked up \d+ times?$/)
  await expect(label).toHaveCount(1)
  return Number((await label.innerText()).match(/\d+/)![0])
}

test.describe('HomeLab deployment', () => {
  test('enx-api answers /api/version with a stamped commit', async () => {
    const response = await fetch(`${API}/api/version`)
    expect(response.status).toBe(200)
    const version = (await response.json()) as { commit?: string }
    console.log('deployed enx-api version:', JSON.stringify(version))
    expect(version.commit).toBeTruthy()
    expect(['unknown', 'dev']).not.toContain(version.commit)

    // Deployments may coalesce commits: a mismatch is printed for a person to
    // investigate, not failed on.
    const main = mainApiCommit()
    const matches =
      main !== '' &&
      (main.startsWith(version.commit!) || version.commit!.startsWith(main))
    console.log(
      `origin/main's latest enx-api commit: ${main || '(origin/main not found)'}`,
      matches ? '(matches)' : '(differs: investigate)'
    )
  })

  test("the extension's ID is the one manifest.json's key fixes", async ({
    extensionId,
  }) => {
    expect(extensionId).toBe(EXTENSION_ID)
  })

  test('GET /api/me without a token answers 401 (503 means auth is down)', async () => {
    const response = await fetch(`${API}/api/me`)
    expect(response.status).toBe(401)
  })

  test('GET /api/me with a garbage bearer token answers 401', async () => {
    const response = await fetch(`${API}/api/me`, {
      headers: { Authorization: 'Bearer not.a.real.token' },
    })
    expect(response.status).toBe(401)
  })

  test("CORS allows the extension's origin", async () => {
    const origin = `chrome-extension://${EXTENSION_ID}`
    const response = await fetch(`${API}/api/version`, {
      headers: { Origin: origin },
    })
    expect(response.headers.get('access-control-allow-origin')).toBe(origin)
  })

  test('CORS does not allow a foreign origin', async () => {
    const origin = 'https://example.com'
    const response = await fetch(`${API}/api/version`, {
      headers: { Origin: origin },
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })
})

test.describe('HomeLab signed in', () => {
  // Never skip: a hand run that skips everything would look like a pass.
  test.beforeAll(() => {
    if (!loginAvailable) {
      throw new Error(
        'The HomeLab lane needs CLERK_SECRET_KEY (Clerk dev instance, sk_test_) and E2E_CLERK_USER_EMAIL -- see E2E_TESTING.md'
      )
    }
  })

  test('the popup shows the session synced from the HomeLab site', async ({
    page,
    extensionId,
    signedIn: _signedIn,
  }) => {
    await openPopup(page, extensionId)
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible({
      timeout: 15_000,
    })
  })

  // One test: the e2e user's data persists between runs, and the lookup is
  // recorded asynchronously, so the count is read before and polled after.
  test('a lookup on the sample article shows a Chinese meaning and is counted in the Word List', async ({
    context,
    page,
    extensionId,
    signedIn: _signedIn,
  }) => {
    test.setTimeout(120_000)
    const site = await context.newPage()
    const before = await wordLookups(site)

    await page.goto(`${SITE}/reader/sample`, { waitUntil: 'domcontentloaded' })
    expect(
      await page.evaluate(
        () =>
          (
            window as unknown as {
              __ENX_ENV__?: { ENX_EXTENSION_ID?: string }
            }
          ).__ENX_ENV__?.ENX_EXTENSION_ID
      )
    ).toBe(EXTENSION_ID)
    await page
      .locator('html[data-enx-extension]')
      .waitFor({ state: 'attached' })
    await enableLearningMode(page, extensionId)

    const popover = await clickWord(page, WORD)
    await expect(popover.getByTestId('word-popover-content')).toContainText(
      /\p{Script=Han}/u
    )

    await expect
      .poll(() => wordLookups(site), { timeout: 60_000, intervals: [2_000] })
      .toBe(before + 1)
  })
})
