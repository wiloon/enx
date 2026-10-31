import { readFileSync } from 'node:fs'

// Expected credit amounts come from the checked-in product configuration,
// never from the server's environment overrides (CREDITS_TRIAL_AMOUNT,
// CREDITS_REFERRAL_INVITEE_BONUS, ...) used to prove the specs red.
const CONFIG_URL = new URL('../../enx-api/config.toml', import.meta.url)

export type CreditsConfig = {
  /** `[credits.trial] amount` */
  trialAmount: number
  /** `[credits.referral] invitee-bonus` */
  inviteeBonus: number
  /** `[credits.referral] invitee-ttl-days` */
  inviteeTtlDays: number
}

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function positiveInteger(toml: string, section: string, key: string): number {
  const body = toml.match(
    new RegExp(
      `^\\[${escapeRegExp(section)}\\]\\s*$([\\s\\S]*?)(?=^\\[|$(?![\\s\\S]))`,
      'm'
    )
  )?.[1]
  const raw = body?.match(
    new RegExp(`^${escapeRegExp(key)}\\s*=\\s*([^#\\n]*?)\\s*(?:#.*)?$`, 'm')
  )?.[1]
  const value = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : NaN
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(
      `Expected a positive integer [${section}] ${key} in enx-api/config.toml`
    )
  }
  return value
}

/** The credit terms the specs expect; throws on a missing or invalid value. */
export function readCreditsConfig(
  toml: string = readFileSync(CONFIG_URL, 'utf8')
): CreditsConfig {
  return {
    trialAmount: positiveInteger(toml, 'credits.trial', 'amount'),
    inviteeBonus: positiveInteger(toml, 'credits.referral', 'invitee-bonus'),
    inviteeTtlDays: positiveInteger(
      toml,
      'credits.referral',
      'invitee-ttl-days'
    ),
  }
}
