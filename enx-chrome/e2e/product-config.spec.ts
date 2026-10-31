import { test, expect } from '@playwright/test'
import { readCreditsConfig } from './product-config'

const toml = (trial: string, referral: string) =>
  `[credits.trial]\n${trial}\n\n[credits.referral]\n${referral}\n\n[stripe.quota]\namount = 7\n`

const valid = toml(
  'amount = 100 # trial\nttl-days = 7',
  'invitee-bonus = 50\ninvitee-ttl-days = 14'
)

test.describe('checked-in credits config', () => {
  test('reads the trial amount and the invitee bonus terms from their sections', () => {
    expect(readCreditsConfig(valid)).toEqual({
      trialAmount: 100,
      inviteeBonus: 50,
      inviteeTtlDays: 14,
    })
  })

  test('reads enx-api/config.toml when given no text', () => {
    const config = readCreditsConfig()
    for (const value of Object.values(config)) {
      expect(Number.isSafeInteger(value) && value > 0).toBe(true)
    }
  })

  for (const [name, text, message] of [
    [
      'a missing section',
      '[credits.referral]\ninvitee-bonus = 50\ninvitee-ttl-days = 14\n',
      '[credits.trial] amount',
    ],
    [
      'a key only in another section',
      toml('ttl-days = 7', 'invitee-bonus = 50\ninvitee-ttl-days = 14'),
      '[credits.trial] amount',
    ],
    [
      'a non-integer value',
      toml('amount = 100', 'invitee-bonus = 1.5\ninvitee-ttl-days = 14'),
      '[credits.referral] invitee-bonus',
    ],
    [
      'a zero value',
      toml('amount = 100', 'invitee-bonus = 50\ninvitee-ttl-days = 0'),
      '[credits.referral] invitee-ttl-days',
    ],
    [
      'a negative value',
      toml('amount = -100', 'invitee-bonus = 50\ninvitee-ttl-days = 14'),
      '[credits.trial] amount',
    ],
  ]) {
    test(`throws on ${name}`, () => {
      expect(() => readCreditsConfig(text)).toThrow(
        `Expected a positive integer ${message} in enx-api/config.toml`
      )
    })
  }
})
