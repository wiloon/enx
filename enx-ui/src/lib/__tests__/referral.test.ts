import {
  REFERRAL_STORAGE_KEY,
  claimStoredReferral,
  claimToast,
  offerMessage,
  pendingRewardLabel,
  readReferralCode,
  storeReferralCode,
} from '../referral'

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
    const claim = jest
      .fn()
      .mockResolvedValue({ success: false, error: 'No such invite code.' })

    expect(await claimStoredReferral(storage, claim, NOW)).toBeNull()
    expect(storage.getItem(REFERRAL_STORAGE_KEY)).toBeNull()
    expect(log).toHaveBeenCalled()
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

  it('drops an expired code without claiming it', async () => {
    const storage = memoryStorage()
    storeReferralCode(storage, 'ABCDEFGH', NOW)
    const claim = jest.fn()

    expect(await claimStoredReferral(storage, claim, NOW + 8 * DAY)).toBeNull()
    expect(claim).not.toHaveBeenCalled()
    expect(storage.getItem(REFERRAL_STORAGE_KEY)).toBeNull()
  })
})
