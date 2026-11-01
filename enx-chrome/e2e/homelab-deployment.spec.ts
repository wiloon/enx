import type { Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { TARGETS } from '../src/config/targets'
import { E2E_USER_EMAIL, EXTENSION_ID, loginAvailable } from './auth'
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

/** The Top-up credit balance the open `/billing` page shows. */
async function topupBalance(billing: Page): Promise<number> {
  const value = billing
    .getByText('Top-up credit balance', { exact: true })
    .locator('xpath=following-sibling::div')
  await expect(value).toHaveText(/^\d+$/)
  return Number(await value.innerText())
}

/**
 * Pays on Stripe's hosted Checkout page with the Sandbox test card. The form
 * differs between sessions (a session for an existing Customer prefills the
 * email; other payment methods may be offered), so every field is filled only
 * when Checkout shows it.
 */
async function payWithTestCard(checkout: Page): Promise<void> {
  const cardNumber = checkout.locator('#cardNumber')
  const cardMethod = checkout.getByTestId('card-accordion-item-button')
  await cardNumber.or(cardMethod).first().waitFor({
    state: 'attached',
    timeout: 30_000,
  })
  // The accordion's own button is laid out with no box, so Playwright calls
  // it hidden; a dispatched click still selects the card.
  if (!(await cardNumber.isVisible())) await cardMethod.dispatchEvent('click')
  await expect(cardNumber).toBeVisible()

  const email = checkout.locator('#email')
  if ((await email.isVisible()) && (await email.isEditable())) {
    await email.fill(E2E_USER_EMAIL)
  }
  await cardNumber.fill('4242 4242 4242 4242')
  await checkout.locator('#cardExpiry').fill('12 / 34')
  await checkout.locator('#cardCvc').fill('123')

  const name = checkout.locator('#billingName')
  if (await name.isVisible()) await name.fill('ENX E2E')
  const country = checkout.locator('#billingCountry')
  if (await country.isVisible()) await country.selectOption('US')
  // A full address when Checkout asks for one (it calculates tax from it).
  const line1 = checkout.locator('#billingAddressLine1')
  if (await line1.isVisible()) {
    await line1.fill('1 Market Street')
    await line1.press('Escape') // closes the address autocomplete
  }
  const city = checkout.locator('#billingLocality')
  if (await city.isVisible()) await city.fill('San Francisco')
  const postalCode = checkout.locator('#billingPostalCode')
  if (await postalCode.isVisible()) await postalCode.fill('94105')
  const state = checkout.locator('#billingAdministrativeArea')
  if (await state.isVisible()) await state.selectOption('CA')
  // Saving to Stripe Link asks for a phone number, and a Link account would
  // make later runs sign in to Link with a code.
  const saveToLink = checkout.locator('#enableStripePass')
  if ((await saveToLink.isVisible()) && (await saveToLink.isChecked())) {
    await saveToLink.dispatchEvent('click')
    await expect(saveToLink).not.toBeChecked()
  }

  await checkout.getByTestId('hosted-payment-submit-button').click()
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

  // One test: the top-up balance persists between runs, and the webhook that
  // grants the credits is asynchronous, so the balance is read before and
  // polled after. HomeLab uses Stripe Sandbox: no real money moves.
  test('a Small top-up paid in Stripe Sandbox Checkout grants exactly 300 top-up credits', async ({
    page,
    headless,
    signedIn: _signedIn,
  }) => {
    // In the body, not a describe-level modifier: a modifier that skips the
    // only selected test also skips the credentials beforeAll.
    test.skip(
      process.platform !== 'darwin' || headless,
      'Stripe Checkout often answers automated Chromium with an hCaptcha challenge, so this test is a hand run: headed on macOS only -- see E2E_TESTING.md'
    )
    test.setTimeout(240_000)
    await page.goto(`${SITE}/billing`)
    const before = await topupBalance(page)
    console.log('Top-up credit balance before the payment:', before)

    // For the run's record only: the hosted page's init response names the
    // session's existing Customer, or null when the session has none.
    const sessionType = page
      .waitForResponse(r => /\/payment_pages\/[^/]+\/init/.test(r.url()), {
        timeout: 60_000,
      })
      .then(async r => ((await r.json()) as { customer?: unknown }).customer)
      .then(customer => (customer ? 'existing Customer' : 'no Customer'))
      .catch(() => 'not observed')

    await page.getByRole('tab', { name: 'One-time credits' }).click()
    await page
      .locator('[data-slot="card"]')
      .filter({ has: page.getByText('Small top-up', { exact: true }) })
      .getByRole('button', { name: 'Buy' })
      .click()
    await page.waitForURL(/^https:\/\/checkout\.stripe\.com\//, {
      timeout: 30_000,
    })
    console.log('Checkout session:', await sessionType)
    // Stripe's risk check can stop a Pay click with an invisible hCaptcha, so
    // Checkout never confirms the payment. That says nothing about ENX, so
    // name it instead of reporting a bare navigation timeout.
    let challenged = false
    let confirmed = false
    page.on('request', r => {
      if (/api\.hcaptcha\.com\/getcaptcha\//.test(r.url())) challenged = true
      if (/\/payment_pages\/[^/]+\/confirm/.test(r.url())) confirmed = true
    })
    await payWithTestCard(page)
    await page
      .waitForURL(`${SITE}/billing/success**`, { timeout: 60_000 })
      .catch((error: unknown) => {
        if (challenged && !confirmed) {
          throw new Error(
            'Stripe stopped the payment with an hCaptcha challenge, and Checkout never confirmed it. No credits were bought and this says nothing about ENX: run the test again -- see E2E_TESTING.md'
          )
        }
        throw error
      })

    await expect
      .poll(
        async () => {
          await page.goto(`${SITE}/billing`)
          return (await topupBalance(page)) - before
        },
        {
          message: `top-up credits gained since the payment (before: ${before})`,
          timeout: 120_000,
          intervals: [3_000],
        }
      )
      .toBe(300)
  })
})
