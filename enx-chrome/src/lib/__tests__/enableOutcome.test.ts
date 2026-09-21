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
  'session-expired',
  'error',
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

  it('flags only layout / exception failures as reportable', () => {
    expect(ALL_REASONS.filter(isReportableFailure)).toEqual([
      'no-article-node',
      'no-words',
      'error',
    ])
  })
})
