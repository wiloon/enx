import { clerk } from '@clerk/testing/playwright'
import type { Page, Response } from '@playwright/test'
import { test, expect, type FreshUser } from './new-user'
import { loginAvailable, LOGIN_SKIP_REASON, UI_ORIGIN } from './auth'
import { readCreditsConfig } from './product-config'

const { trialAmount, inviteeBonus, inviteeTtlDays } = readCreditsConfig()

const credits = (amount: number) => amount.toLocaleString('en-US')

// `next dev` compiles a route on its first visit, well past expect's 5 s.
const PAGE_LOAD = { timeout: 30_000 }

const isClaim = (response: Response) =>
  response.request().method() === 'POST' &&
  new URL(response.url()).pathname === '/api/referral/claim'

// ADR-051: the claim runs on the website for whoever is signed in there, so
// readiness is read from website responses and UI, never from the
// extension's validateSession, which can still answer for the previous user.
async function signInAs(page: Page, user: FreshUser) {
  await page.goto(`${UI_ORIGIN}/`)
  await clerk.signIn({ page, emailAddress: user.email })
}

async function expectTrialBalance(page: Page, amount: number) {
  await page.goto(`${UI_ORIGIN}/billing`)
  await expect(
    page.getByText(
      new RegExp(`^${credits(amount)} trial credits · expires `)
    )
  ).toBeVisible(PAGE_LOAD)
}

async function expectInviteeBonus(claim: Response) {
  expect(claim.status(), 'claim the invite').toBe(200)
  const body = await claim.json()
  expect(body.bonus, `invitee bonus in ${JSON.stringify(body)}`).toBe(
    inviteeBonus
  )
  const expected = Date.now() / 1000 + inviteeTtlDays * 24 * 60 * 60
  expect(body.trialExpiresAt, 'trial expiry in Unix seconds').toEqual(
    expect.any(Number)
  )
  expect(Math.abs(body.trialExpiresAt - expected)).toBeLessThan(5 * 60)
}

test.describe('Invite link', () => {
  test.skip(!loginAvailable, LOGIN_SKIP_REASON)
  test.setTimeout(240_000)

  test('invitees who claim one code get the bonus; the inviter is not paid before a payment', async ({
    page,
    freshUsers,
  }) => {
    const inviter = await freshUsers.create()
    const firstInvitee = await freshUsers.create()
    const secondInvitee = await freshUsers.create()

    // The inviter reads the link.
    await signInAs(page, inviter)
    await page.goto(`${UI_ORIGIN}/invite`)
    const linkField = page.getByLabel('Your invite link')
    await expect(linkField).toHaveValue(/\/invite\/[A-Z0-9]+$/, PAGE_LOAD)
    const link = await linkField.inputValue()
    expect(link.startsWith(`${UI_ORIGIN}/invite/`), link).toBe(true)

    // A signed-out invitee sees the offer, then signs up; ReferralClaimer
    // claims the stored code with no action on the page.
    await clerk.signOut({ page })
    await page.goto(link)
    await expect(
      page.getByText(
        `Join via this link and get ${credits(trialAmount + inviteeBonus)} free AI credits (valid for ${inviteeTtlDays} days).`,
        { exact: true }
      )
    ).toBeVisible(PAGE_LOAD)
    const firstClaim = page.waitForResponse(isClaim)
    await clerk.signIn({ page, emailAddress: firstInvitee.email })
    await expectInviteeBonus(await firstClaim)
    await expect(
      page.getByText(
        new RegExp(
          `^\\+${credits(inviteeBonus)} bonus credits from your invite · expires `
        )
      )
    ).toBeVisible()
    await expectTrialBalance(page, trialAmount + inviteeBonus)

    // ADR-051 Decision 2: someone who signed up first claims the same code
    // by opening the link within the claim window; one code has no invitee
    // limit.
    await clerk.signOut({ page })
    await signInAs(page, secondInvitee)
    await expectTrialBalance(page, trialAmount)
    const secondClaim = page.waitForResponse(isClaim)
    await page.goto(link)
    await expectInviteeBonus(await secondClaim)
    await expectTrialBalance(page, trialAmount + inviteeBonus)

    // The referrer is paid only after an invitee's first payment, but both
    // claims reached them.
    await clerk.signOut({ page })
    await signInAs(page, inviter)
    await expectTrialBalance(page, trialAmount)
    await page.goto(`${UI_ORIGIN}/invite`)
    await expect(page.getByTestId('invite-stat-invited')).toHaveText(
      '2',
      PAGE_LOAD
    )
    await expect(page.getByTestId('invite-stat-earned')).toHaveText('0')
    await expect(page.getByText('No pending rewards.')).toBeVisible()
  })
})
