import { readFileSync } from 'fs'
import path from 'path'
import {
  FREE_DAILY_LOOKUPS,
  SUBSCRIBED_DAILY_LOOKUPS,
  SUBSCRIPTION_PLANS,
  TOPUP_TIERS,
} from '../plans'

// The credits a purchase grants come from enx-api/config.toml
// [stripe.credits]; /pricing and /billing advertise plans.ts. Read the file at
// run time: the enx-ui image build contains only enx-ui/, and `next build`
// type-checks test files, so a static import would break it.
const CONFIG_PATH = path.resolve(__dirname, '../../../../enx-api/config.toml')

function configSection(section: string): Record<string, number> {
  const lines = readFileSync(CONFIG_PATH, 'utf8').split(/\r?\n/)
  const values: Record<string, number> = {}
  let inSection = false
  for (const raw of lines) {
    const line = raw.trim()
    if (line.startsWith('[')) {
      inSection = line === `[${section}]`
      continue
    }
    if (!inSection) continue
    const match = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(\d+)\s*(?:#.*)?$/)
    if (match) values[match[1]] = Number(match[2])
  }
  return values
}

// "1,500 credits/mo" -> 1500
function labelCredits(label: string): number {
  const match = label.match(/^([\d,]+) credits/)
  if (!match)
    throw new Error(`no credit amount in label ${JSON.stringify(label)}`)
  return Number(match[1].replace(/,/g, ''))
}

function configCredits(key: string): number {
  const value = configSection('stripe.credits')[key]
  if (value === undefined) {
    throw new Error(`enx-api/config.toml [stripe.credits] has no ${key}`)
  }
  return value
}

describe('plans.ts credits match enx-api/config.toml [stripe.credits]', () => {
  it.each(SUBSCRIPTION_PLANS.map((p) => [p.plan, p.creditsLabel]))(
    'subscription %s advertises what the ledger grants',
    (plan, label) => {
      expect(labelCredits(label)).toBe(configCredits(`subscription-${plan}`))
    }
  )

  it.each(TOPUP_TIERS.map((t) => [t.tier, t.creditsLabel]))(
    'top-up %s advertises what the ledger grants',
    (tier, label) => {
      expect(labelCredits(label)).toBe(configCredits(`topup-${tier}`))
    }
  )

  it('covers every plan and tier the config grants', () => {
    expect(SUBSCRIPTION_PLANS.map((p) => p.plan).sort()).toEqual([
      'max',
      'pro',
      'pro-plus',
    ])
    expect(TOPUP_TIERS.map((t) => t.tier).sort()).toEqual([
      'large',
      'medium',
      'small',
    ])
  })
})

// /pricing names the daily dictionary lookup limits; enx-api enforces
// [stripe.quota]. Deployments may override them by env (w10n-config), which
// this test cannot see -- keep those in step by hand.
describe('plans.ts lookup limits match enx-api/config.toml [stripe.quota]', () => {
  it('advertises the free limit the API enforces', () => {
    expect(FREE_DAILY_LOOKUPS).toBe(
      configSection('stripe.quota')['dictionary-lookup-daily-free']
    )
  })

  it('advertises the subscriber limit the API enforces', () => {
    expect(SUBSCRIBED_DAILY_LOOKUPS).toBe(
      configSection('stripe.quota')['dictionary-lookup-daily-subscribed']
    )
  })
})
