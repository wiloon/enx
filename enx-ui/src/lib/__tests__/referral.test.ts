import {
  REFERRAL_STORAGE_KEY,
  type ReferralClaimContext,
  claimStoredReferral,
  claimToast,
  createReferralClaimRunner,
  offerMessage,
  pendingRewardLabel,
  readReferralCode,
  storeReferralCode,
} from '../referral'
import type { ApiResponse, ReferralClaimData } from '@/types'

// An in-memory Storage, so the rules run without a browser.
function memoryStorage(): Storage {
  const items = new Map<string, string>()
  return {
    get length() {
      return items.size
    },
    clear: () => items.clear(),
    getItem: (k) => items.get(k) ?? null,
    key: (i) => [...items.keys()][i] ?? null,
    removeItem: (k) => void items.delete(k),
    setItem: (k, v) => void items.set(k, v),
  }
}

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 9, 1, 12)

describe('the stored invite code', () => {
  it('is kept under enx.referral with the time it was saved', () => {
    const storage = memoryStorage()
    storeReferralCode(storage, 'ABCDEFGH', NOW)

    expect(JSON.parse(storage.getItem(REFERRAL_STORAGE_KEY)!)).toEqual({
      code: 'ABCDEFGH',
      savedAt: NOW,
    })
    expect(readReferralCode(storage, NOW + 6 * DAY)).toBe('ABCDEFGH')
  })

  it('expires after 7 days', () => {
    const storage = memoryStorage()
    storeReferralCode(storage, 'ABCDEFGH', NOW)
    expect(readReferralCode(storage, NOW + 7 * DAY)).toBeNull()
  })

  it('reads as absent when missing or malformed', () => {
    const storage = memoryStorage()
    expect(readReferralCode(storage, NOW)).toBeNull()
    storage.setItem(REFERRAL_STORAGE_KEY, 'not json')
    expect(readReferralCode(storage, NOW)).toBeNull()
    storage.setItem(REFERRAL_STORAGE_KEY, JSON.stringify({ code: 7 }))
    expect(readReferralCode(storage, NOW)).toBeNull()
  })
})

describe('claimToast', () => {
  it('names the bonus and when the trial expires', () => {
    const expires = Date.UTC(2026, 9, 15, 12) / 1000
    expect(claimToast({ bonus: 100, trialExpiresAt: expires })).toBe(
      '+100 bonus credits from your invite · expires Oct 15'
    )
  })

  it('is null when no bonus was granted', () => {
    expect(claimToast({ bonus: 0, trialExpiresAt: null })).toBeNull()
  })
})

describe('pendingRewardLabel', () => {
  it('names the amount and the expected date', () => {
    expect(
      pendingRewardLabel({
        amount: 1500,
        dueAt: Date.UTC(2026, 9, 20, 12) / 1000,
      })
    ).toBe('1,500 credits · expected Oct 20')
  })
})

describe('offerMessage', () => {
  it('uses the numbers from the API', () => {
    expect(offerMessage({ credits: 200, days: 14 })).toBe(
      'Join via this link and get 200 free AI credits (valid for 14 days).'
    )
    expect(offerMessage({ credits: 150, days: 10 })).toBe(
      'Join via this link and get 150 free AI credits (valid for 10 days).'
    )
  })

  it('drops the credits when there are none', () => {
    expect(offerMessage({ credits: 0, days: 7 })).toBe(
      'Join Catglish via this link.'
    )
  })
})

describe('claimStoredReferral', () => {
  it('does nothing without a stored code', async () => {
    const claim = jest.fn()
    expect(await claimStoredReferral(memoryStorage(), claim, NOW)).toBeNull()
    expect(claim).not.toHaveBeenCalled()
  })

  it('claims the code, clears it and returns the toast', async () => {
    const storage = memoryStorage()
    storeReferralCode(storage, 'ABCDEFGH', NOW)
    const claim = jest.fn().mockResolvedValue({
      success: true,
      data: { bonus: 100, trialExpiresAt: Date.UTC(2026, 9, 15, 12) / 1000 },
    })

    const toast = await claimStoredReferral(storage, claim, NOW)

    expect(claim).toHaveBeenCalledWith('ABCDEFGH')
    expect(toast).toBe('+100 bonus credits from your invite · expires Oct 15')
    expect(storage.getItem(REFERRAL_STORAGE_KEY)).toBeNull()
  })

  it('clears the code and stays quiet when the claim is refused', async () => {
    const storage = memoryStorage()
    storeReferralCode(storage, 'ABCDEFGH', NOW)
    const log = jest.spyOn(console, 'info').mockImplementation(() => {})
    const claim = jest.fn().mockResolvedValue({
      success: false,
      error: 'No such invite code.',
      status: 409,
    })

    expect(await claimStoredReferral(storage, claim, NOW)).toBeNull()
    expect(storage.getItem(REFERRAL_STORAGE_KEY)).toBeNull()
    expect(log).toHaveBeenCalled()
    log.mockRestore()
  })

  it('keeps the code for the next try when the server fails', async () => {
    const storage = memoryStorage()
    storeReferralCode(storage, 'ABCDEFGH', NOW)
    const log = jest.spyOn(console, 'info').mockImplementation(() => {})
    const claim = jest.fn().mockResolvedValue({
      success: false,
      error: 'Something went wrong on our end.',
      status: 500,
    })

    expect(await claimStoredReferral(storage, claim, NOW)).toBeNull()
    expect(readReferralCode(storage, NOW)).toBe('ABCDEFGH')
    log.mockRestore()
  })

  it('keeps the code for the next try when the session has expired', async () => {
    const storage = memoryStorage()
    storeReferralCode(storage, 'ABCDEFGH', NOW)
    const log = jest.spyOn(console, 'info').mockImplementation(() => {})
    const claim = jest.fn().mockResolvedValue({
      success: false,
      error: 'Your session has expired.',
      status: 401,
    })

    expect(await claimStoredReferral(storage, claim, NOW)).toBeNull()
    expect(readReferralCode(storage, NOW)).toBe('ABCDEFGH')
    log.mockRestore()
  })

  it('keeps the code for the next try when the request was rate-limited', async () => {
    const storage = memoryStorage()
    storeReferralCode(storage, 'ABCDEFGH', NOW)
    const log = jest.spyOn(console, 'info').mockImplementation(() => {})
    const claim = jest.fn().mockResolvedValue({
      success: false,
      error: 'Too many requests.',
      status: 429,
    })

    expect(await claimStoredReferral(storage, claim, NOW)).toBeNull()
    expect(readReferralCode(storage, NOW)).toBe('ABCDEFGH')
    log.mockRestore()
  })

  it('keeps the code for the next try when the server cannot be reached', async () => {
    const storage = memoryStorage()
    storeReferralCode(storage, 'ABCDEFGH', NOW)
    const log = jest.spyOn(console, 'info').mockImplementation(() => {})
    const claim = jest.fn().mockResolvedValue({
      success: false,
      error: "Can't reach Catglish right now.",
    })

    expect(await claimStoredReferral(storage, claim, NOW)).toBeNull()
    expect(readReferralCode(storage, NOW)).toBe('ABCDEFGH')
    log.mockRestore()
  })

  it('stays quiet when the claim granted no bonus', async () => {
    const storage = memoryStorage()
    storeReferralCode(storage, 'ABCDEFGH', NOW)
    const claim = jest.fn().mockResolvedValue({
      success: true,
      data: { bonus: 0, trialExpiresAt: null },
    })

    expect(await claimStoredReferral(storage, claim, NOW)).toBeNull()
    expect(storage.getItem(REFERRAL_STORAGE_KEY)).toBeNull()
  })

  describe('when another invite link is opened while the claim is in flight', () => {
    // A claim whose answer the test hands over after changing storage.
    function pendingClaim() {
      let answer!: (resp: ApiResponse<ReferralClaimData>) => void
      const claim = jest.fn(
        () =>
          new Promise<ApiResponse<ReferralClaimData>>((resolve) => {
            answer = resolve
          })
      )
      return {
        claim,
        answer: (resp: ApiResponse<ReferralClaimData>) => answer(resp),
      }
    }

    it('keeps the newer code when the first claim is refused', async () => {
      const storage = memoryStorage()
      storeReferralCode(storage, 'AAAAAAAA', NOW)
      const log = jest.spyOn(console, 'info').mockImplementation(() => {})
      const { claim, answer } = pendingClaim()

      const claiming = claimStoredReferral(storage, claim, NOW)
      storeReferralCode(storage, 'BBBBBBBB', NOW + 1)
      answer({ success: false, error: 'No such invite code.', status: 409 })
      await claiming

      expect(claim).toHaveBeenCalledWith('AAAAAAAA')
      expect(readReferralCode(storage, NOW + 1)).toBe('BBBBBBBB')
      log.mockRestore()
    })

    it('keeps the newer code when the first claim succeeds', async () => {
      const storage = memoryStorage()
      storeReferralCode(storage, 'AAAAAAAA', NOW)
      const { claim, answer } = pendingClaim()

      const claiming = claimStoredReferral(storage, claim, NOW)
      storeReferralCode(storage, 'BBBBBBBB', NOW + 1)
      answer({ success: true, data: { bonus: 0, trialExpiresAt: null } })
      await claiming

      expect(readReferralCode(storage, NOW + 1)).toBe('BBBBBBBB')
    })

    it('clears the code when the same link was stored again', async () => {
      const storage = memoryStorage()
      storeReferralCode(storage, 'AAAAAAAA', NOW)
      const log = jest.spyOn(console, 'info').mockImplementation(() => {})
      const { claim, answer } = pendingClaim()

      const claiming = claimStoredReferral(storage, claim, NOW)
      storeReferralCode(storage, 'AAAAAAAA', NOW + 1)
      answer({ success: false, error: 'Already claimed.', status: 409 })
      await claiming

      expect(storage.getItem(REFERRAL_STORAGE_KEY)).toBeNull()
      log.mockRestore()
    })
  })

  it('drops an expired code without claiming it', async () => {
    const storage = memoryStorage()
    storeReferralCode(storage, 'ABCDEFGH', NOW)
    const claim = jest.fn()

    expect(await claimStoredReferral(storage, claim, NOW + 8 * DAY)).toBeNull()
    expect(claim).not.toHaveBeenCalled()
    expect(storage.getItem(REFERRAL_STORAGE_KEY)).toBeNull()
  })
})

describe('createReferralClaimRunner', () => {
  const BONUS = { success: true, data: { bonus: 100, trialExpiresAt: null } }
  const REFUSED = { success: false, error: 'No such invite code.', status: 409 }
  const SERVER_ERROR = {
    success: false,
    error: 'Something went wrong.',
    status: 500,
  }

  // claimReferral answering one call at a time, when the test says so, and
  // recording how many calls were in flight at once.
  function deferredClaims() {
    const answers: Array<{
      resolve: (resp: ApiResponse<ReferralClaimData>) => void
      reject: (err: unknown) => void
    }> = []
    let inFlight = 0
    let maxInFlight = 0
    const claim = jest.fn(() =>
      new Promise<ApiResponse<ReferralClaimData>>((resolve, reject) => {
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        answers.push({ resolve, reject })
      }).finally(() => {
        inFlight--
      })
    )
    const settle = async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve()
    }
    return {
      claim,
      maxInFlight: () => maxInFlight,
      answer: async (n: number, resp: ApiResponse<ReferralClaimData>) => {
        answers[n].resolve(resp)
        await settle()
      },
      fail: async (n: number, err: unknown) => {
        answers[n].reject(err)
        await settle()
      },
    }
  }

  function setup() {
    const storage = memoryStorage()
    const claims = deferredClaims()
    const onBonus = jest.fn()
    const runner = createReferralClaimRunner()
    runner.setContext({ storage, claim: claims.claim, onBonus })
    return {
      storage,
      claims,
      onBonus,
      runner,
      setContext: (next: ReferralClaimContext | null) =>
        runner.setContext(next),
      store: (code: string) => storeReferralCode(storage, code),
    }
  }

  beforeEach(() => {
    jest.spyOn(console, 'info').mockImplementation(() => {})
  })
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('claims the latest stored code after the active claim settles, not during it', async () => {
    const { storage, claims, onBonus, runner, store } = setup()
    store('AAAAAAAA')
    runner.trigger()
    store('BBBBBBBB')
    runner.trigger()
    expect(claims.claim).toHaveBeenCalledTimes(1)

    await claims.answer(0, REFUSED)
    expect(claims.claim.mock.calls).toEqual([['AAAAAAAA'], ['BBBBBBBB']])
    await claims.answer(1, BONUS)

    expect(onBonus).toHaveBeenCalledTimes(1)
    expect(onBonus).toHaveBeenCalledWith('+100 bonus credits from your invite')
    expect(storage.getItem(REFERRAL_STORAGE_KEY)).toBeNull()
  })

  it('makes one call when nothing triggers during it, even if the server fails', async () => {
    const { storage, claims, runner, store } = setup()
    store('AAAAAAAA')
    runner.trigger()

    await claims.answer(0, SERVER_ERROR)

    expect(claims.claim).toHaveBeenCalledTimes(1)
    expect(readReferralCode(storage)).toBe('AAAAAAAA')
  })

  it('retries the same code once when it is reopened during a claim that fails', async () => {
    const { storage, claims, runner, store } = setup()
    store('AAAAAAAA')
    runner.trigger()
    store('AAAAAAAA')
    runner.trigger()

    await claims.answer(0, SERVER_ERROR)
    expect(claims.claim.mock.calls).toEqual([['AAAAAAAA'], ['AAAAAAAA']])
    await claims.answer(1, SERVER_ERROR)

    expect(claims.claim).toHaveBeenCalledTimes(2)
    expect(readReferralCode(storage)).toBe('AAAAAAAA')
  })

  it('makes no follow-up call when the reopened code got a final answer', async () => {
    const { storage, claims, runner, store } = setup()
    store('AAAAAAAA')
    runner.trigger()
    store('AAAAAAAA')
    runner.trigger()

    await claims.answer(0, REFUSED)

    expect(claims.claim).toHaveBeenCalledTimes(1)
    expect(storage.getItem(REFERRAL_STORAGE_KEY)).toBeNull()
  })

  it('coalesces triggers during a claim into one follow-up for the newest code', async () => {
    const { claims, runner, store } = setup()
    store('AAAAAAAA')
    runner.trigger()
    runner.trigger()
    store('BBBBBBBB')
    runner.trigger()
    store('CCCCCCCC')
    runner.trigger()

    await claims.answer(0, REFUSED)
    expect(claims.claim.mock.calls).toEqual([['AAAAAAAA'], ['CCCCCCCC']])

    store('DDDDDDDD')
    runner.trigger()
    await claims.answer(1, REFUSED)
    expect(claims.claim.mock.calls).toEqual([
      ['AAAAAAAA'],
      ['CCCCCCCC'],
      ['DDDDDDDD'],
    ])
    await claims.answer(2, REFUSED)

    expect(claims.claim).toHaveBeenCalledTimes(3)
    expect(claims.maxInFlight()).toBe(1)
  })

  it('makes no follow-up call when there is no current context, and claims on the next trigger', async () => {
    const { storage, claims, onBonus, runner, setContext, store } = setup()
    store('AAAAAAAA')
    runner.trigger()
    store('BBBBBBBB')
    runner.trigger()
    setContext(null)

    await claims.answer(0, REFUSED)
    expect(claims.claim).toHaveBeenCalledTimes(1)
    expect(readReferralCode(storage)).toBe('BBBBBBBB')

    setContext({ storage, claim: claims.claim, onBonus })
    runner.trigger()
    expect(claims.claim).toHaveBeenLastCalledWith('BBBBBBBB')
    expect(claims.claim).toHaveBeenCalledTimes(2)
  })

  it('uses the claim wiring current when the follow-up starts', async () => {
    const { storage, claims, onBonus, runner, setContext, store } = setup()
    store('AAAAAAAA')
    runner.trigger()
    runner.trigger()
    const otherSession = jest.fn().mockResolvedValue(BONUS)
    setContext({ storage, claim: otherSession, onBonus })

    await claims.answer(0, SERVER_ERROR)

    expect(claims.claim).toHaveBeenCalledTimes(1)
    expect(otherSession).toHaveBeenCalledWith('AAAAAAAA')
  })

  it('reports the bonus of a claim that settles after its context is gone', async () => {
    const { claims, onBonus, runner, setContext, store } = setup()
    store('AAAAAAAA')
    runner.trigger()
    setContext(null)

    await claims.answer(0, BONUS)

    expect(onBonus).toHaveBeenCalledWith('+100 bonus credits from your invite')
  })

  it('recovers from a claim that throws: keeps the code and runs the pending follow-up', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {})
    const { storage, claims, runner, store } = setup()
    store('AAAAAAAA')
    runner.trigger()
    runner.trigger()

    await claims.fail(0, new Error('boom'))

    expect(error).toHaveBeenCalled()
    expect(readReferralCode(storage)).toBe('AAAAAAAA')
    expect(claims.claim).toHaveBeenCalledTimes(2)
    await claims.fail(1, new Error('boom again'))

    runner.trigger()
    expect(claims.claim).toHaveBeenCalledTimes(3)
  })
})
