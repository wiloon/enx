// Rules behind the credit history timeline (ADR-063), shared by the user's
// /billing/history and the admin's /admin/users/[id]. enx-api sends codes
// only; every label the user reads is decided here.

export interface TransactionLabel {
  label: string
  // Why a zero-amount row changed nothing (ADR-063 Decision 6a).
  explanation?: string
}

const TYPE_LABELS: Record<string, string> = {
  GRANT_SUBSCRIPTION: 'Subscription credits',
  GRANT_TOPUP: 'Credits purchased',
  GRANT_TRIAL: 'Free trial credits',
  GRANT_REFERRAL_BONUS: 'Invite bonus (trial credits)',
  GRANT_REFERRAL_REWARD: 'Referral reward',
  GRANT_ADMIN: 'Credits added by support',
  DEDUCT_ADMIN: 'Credits removed by support',
  CLAWBACK: 'Credits removed after refund',
  REFUND: 'AI request failed, credits returned',
}

const AI_FEATURE_LABELS: Record<string, string> = {
  lookup_word_ai: 'AI word lookup',
  translate_word_in_context: 'Word translation',
  translate_sentence: 'Sentence translation',
  translate_sentence_with_word: 'Sentence translation',
  rephrase_to_english: 'Rephrase',
}

const EXPIRE_LABELS: Record<string, string> = {
  trial: 'Trial credits expired',
  subscription: 'Unused subscription credits expired',
}

// SETTLE is AI spend; CONSUME is the older name nothing writes any more.
export function isAiSpend(type: string): boolean {
  return type === 'SETTLE' || type === 'CONSUME'
}

export function aiFeatureLabel(feature: string): string {
  return AI_FEATURE_LABELS[feature] ?? 'AI usage'
}

export function transactionLabel(row: {
  type: string
  feature: string
  amount: number
}): TransactionLabel {
  const { type, feature, amount } = row
  if (amount === 0 && type === 'GRANT_SUBSCRIPTION') {
    return {
      label: 'Subscription payment recorded',
      explanation: 'No credits added',
    }
  }
  if (amount === 0 && type === 'CLAWBACK') {
    return { label: 'Refund recorded', explanation: 'No credits removed' }
  }
  if (isAiSpend(type)) return { label: aiFeatureLabel(feature) }
  if (type === 'EXPIRE') {
    return { label: EXPIRE_LABELS[feature] ?? 'Credits expired' }
  }
  const known = TYPE_LABELS[type]
  if (known) return { label: known }
  if (amount > 0) return { label: 'Credits added' }
  if (amount < 0) return { label: 'Credits removed' }
  return { label: 'Balance updated' }
}

// A ledger amount with its sign: +25 for a grant, -90 for a clawback, +0
// for a row that changed nothing.
export function signedCredits(n: number): string {
  return n >= 0 ? `+${n}` : String(n)
}

// The reason support gave for a grant or deduction, which the user sees
// (ADR-063 Decision 5). Other types' notes are internal.
export function supportNote(row: {
  type: string
  note?: string
}): string | null {
  if (row.type !== 'GRANT_ADMIN' && row.type !== 'DEDUCT_ADMIN') return null
  if (!row.note) return null
  return `Note from support: ${row.note}`
}

// Rows written before total_balance_after existed have none (Decision 11).
export function balanceText(total: number | null): string {
  return total === null ? '—' : String(total)
}

type TimelineRow = {
  createdAt: string
  type: string
  feature: string
  amount: number
  totalBalanceAfter: number | null
}

// Each loaded row's identity across refetches and "Load more": its id when it
// has one (admin rows), else its time, type and feature plus a counter for
// exact repeats. New rows arrive at the top, so the counter runs from the
// oldest loaded row. Returned in the rows' order.
export function timelineRowKeys(
  rows: { id?: string; createdAt: string; type: string; feature: string }[]
): string[] {
  const seen = new Map<string, number>()
  const keys: string[] = new Array(rows.length)
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i]
    if (r.id) {
      keys[i] = r.id
      continue
    }
    const base = `${r.createdAt}-${r.type}-${r.feature}`
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    keys[i] = `${base}-${n}`
  }
  return keys
}

export type TimelineItem<T extends TimelineRow> =
  | { kind: 'row'; row: T }
  | {
      kind: 'group'
      // Local day and feature: stays the same as rows join the group.
      key: string
      feature: string
      // Newest first, as loaded.
      rows: T[]
      count: number
      amount: number
      totalBalanceAfter: number | null
    }

// Merges the loaded rows (newest first, every page so far) into the
// timeline: one row per same-day AI spend of one feature code (ADR-063
// Decision 12). A group sits where its newest row was; the rows between its
// members stay below it in their order. Days are the browser's local days.
export function groupTimeline<T extends TimelineRow>(
  rows: T[]
): TimelineItem<T>[] {
  type Pending = { kind: 'group'; key: string; rows: T[] }
  const items: ({ kind: 'row'; row: T } | Pending)[] = []
  const groups = new Map<string, Pending>()
  for (const row of rows) {
    if (!isAiSpend(row.type)) {
      items.push({ kind: 'row', row })
      continue
    }
    const key = `${localDayKey(row.createdAt)}|${row.feature}`
    const group = groups.get(key)
    if (group) {
      group.rows.push(row)
      continue
    }
    const created = { kind: 'group' as const, key, rows: [row] }
    groups.set(key, created)
    items.push(created)
  }
  return items.map((item): TimelineItem<T> => {
    if (item.kind === 'row') return item
    const [newest] = item.rows
    if (item.rows.length === 1) return { kind: 'row', row: newest }
    return {
      kind: 'group',
      key: item.key,
      feature: newest.feature,
      rows: item.rows,
      count: item.rows.length,
      amount: item.rows.reduce((sum, r) => sum + r.amount, 0),
      totalBalanceAfter: newest.totalBalanceAfter,
    }
  })
}

function localDayKey(at: string): string {
  const d = new Date(at)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

export function localDate(at: string): string {
  return new Date(at).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function localTime(at: string): string {
  const d = new Date(at)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
