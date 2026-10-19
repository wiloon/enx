import {
  ENABLE_OK,
  EnableFailureReason,
  failed,
  failureMessage,
  isReportableFailure,
} from '@/lib/enableOutcome'

const ALL_REASONS: EnableFailureReason[] = [
  'unsupported-page',
  'no-article-node',
  'no-words',
  'lookup-failed',
  'rate-limited',
  'session-expired',
  'account-disabled',
  'error',
  'injection-blocked',
  'not-english',
]

describe('enableOutcome', () => {
  it('builds ok / failed outcomes', () => {
    expect(ENABLE_OK).toEqual({ ok: true })
    expect(failed('no-article-node')).toEqual({
      ok: false,
      reason: 'no-article-node',
    })
  })

  it('has a non-empty English message for every failure reason', () => {
    for (const reason of ALL_REASONS) {
      const message = failureMessage(reason)
      expect(message.length).toBeGreaterThan(10)
      // AGENTS.md: user-facing copy is English, never Chinese.
      expect(message).not.toMatch(/[一-鿿]/)
    }
  })

  // ADR-060: the request rate limit is "wait a moment", not a broken
  // connection or a used-up quota.
  it('tells a rate-limited reader to wait and try again', () => {
    expect(failureMessage('rate-limited')).toBe(
      'Too many requests. Please wait a moment and try again.'
    )
  })

  // ADR-062 Decision 5: enx-ui and the extension show the same message.
  it('tells a disabled account so', () => {
    expect(failureMessage('account-disabled')).toBe(
      'This account has been disabled.'
    )
  })

  it('flags only layout / exception failures as reportable', () => {
    expect(ALL_REASONS.filter(isReportableFailure)).toEqual([
      'no-article-node',
      'no-words',
      'error',
    ])
  })
})
