import { failed, failureMessage, ENABLE_OK } from '@/lib/enableOutcome'
import {
  badgeFor,
  runWithStatus,
  statusForOutcome,
  type LearningModeStatus,
} from '@/lib/learningModeStatus'

describe('badgeFor (adr-046 Decision 1)', () => {
  const visible: LearningModeStatus[] = [
    { status: 'processing' },
    { status: 'ready' },
    { status: 'error', reason: 'lookup-failed' },
  ]

  it('shows no badge and the default title when off', () => {
    expect(badgeFor({ status: 'off' })).toEqual({ text: '', title: null })
  })

  // Colour alone fails colour-blind users: character AND colour differ.
  it('gives each visible status its own character, colour and title', () => {
    const badges = visible.map(badgeFor)
    for (const key of ['text', 'color', 'title'] as const) {
      expect(new Set(badges.map(b => b[key])).size).toBe(badges.length)
    }
  })

  it('keeps every badge within Chrome’s 4-character guidance', () => {
    for (const status of visible) {
      expect(badgeFor(status).text.length).toBeLessThanOrEqual(4)
    }
  })

  it('uses hex colours, which setBadgeBackgroundColor accepts', () => {
    for (const status of visible) {
      expect(badgeFor(status).color).toMatch(/^#[0-9A-F]{6}$/i)
    }
  })

  it('takes the error title from failureMessage', () => {
    expect(badgeFor({ status: 'error', reason: 'session-expired' }).title).toBe(
      failureMessage('session-expired')
    )
  })

  it('asks a signed-out user to sign in (Decision 7)', () => {
    expect(badgeFor({ status: 'error', reason: 'signed-out' })).toMatchObject({
      text: '!',
      title: 'Sign in to Catglish to use learning mode on this site.',
    })
  })
})

describe('statusForOutcome (adr-046 Decision 3)', () => {
  it('is ready when the run succeeded', () => {
    expect(statusForOutcome(ENABLE_OK)).toEqual({ status: 'ready' })
  })

  it.each(['lookup-failed', 'session-expired', 'error'] as const)(
    'is an error for the actionable failure %s',
    reason => {
      expect(statusForOutcome(failed(reason))).toEqual({
        status: 'error',
        reason,
      })
    }
  )

  it.each(['unsupported-page', 'no-article-node', 'no-words'] as const)(
    'is off for %s, which the user cannot act on',
    reason => {
      expect(statusForOutcome(failed(reason))).toEqual({ status: 'off' })
    }
  )
})

describe('runWithStatus', () => {
  it('reports processing then ready on a successful run', async () => {
    const report = jest.fn()
    await runWithStatus(async found => {
      found()
      return ENABLE_OK
    }, report)
    expect(report.mock.calls.map(([s]) => s)).toEqual([
      { status: 'processing' },
      { status: 'ready' },
    ])
  })

  it.each(['no-article-node', 'unsupported-page'] as const)(
    'never reports processing when the run fails with %s before finding an article',
    async reason => {
      const report = jest.fn()
      await runWithStatus(async () => failed(reason), report)
      expect(report.mock.calls.map(([s]) => s)).toEqual([{ status: 'off' }])
    }
  )

  it('reports an error for an expired session', async () => {
    const report = jest.fn()
    await runWithStatus(async found => {
      found()
      return failed('session-expired')
    }, report)
    expect(report).toHaveBeenLastCalledWith({
      status: 'error',
      reason: 'session-expired',
    })
  })

  it('reports an error and rethrows when the run throws', async () => {
    const report = jest.fn()
    await expect(
      runWithStatus(async () => {
        throw new Error('boom')
      }, report)
    ).rejects.toThrow('boom')
    expect(report).toHaveBeenCalledWith({ status: 'error', reason: 'error' })
  })

  // SPA rebuild: a run that lost to a newer tweet switch must not overwrite
  // the newer run's badge.
  it('reports nothing once superseded', async () => {
    const report = jest.fn()
    let current = true
    const outcome = await runWithStatus(
      async found => {
        current = false
        found()
        return ENABLE_OK
      },
      report,
      () => current
    )
    expect(outcome).toBe(ENABLE_OK)
    expect(report).not.toHaveBeenCalled()
  })
})
