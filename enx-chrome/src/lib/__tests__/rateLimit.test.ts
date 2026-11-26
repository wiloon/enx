import { offersUpgrade } from '@/lib/rateLimit'

describe('offersUpgrade', () => {
  it('offers the upgrade for a quota refusal enx-api marked for a free user', () => {
    expect(
      offersUpgrade({
        status: 429,
        code: 'lookup_quota_exceeded',
        upgrade: true,
      })
    ).toBe(true)
  })

  it.each([
    ['an absent flag', { status: 429, code: 'lookup_quota_exceeded' }],
    [
      'a false flag',
      { status: 429, code: 'lookup_quota_exceeded', upgrade: false },
    ],
    [
      'a string flag',
      {
        status: 429,
        code: 'lookup_quota_exceeded',
        upgrade: 'true' as unknown as boolean,
      },
    ],
    ['a 429 with no code', { status: 429, upgrade: true }],
    [
      'the request rate limit',
      { status: 429, code: 'too_many_requests', upgrade: true },
    ],
    [
      'another status',
      { status: 403, code: 'lookup_quota_exceeded', upgrade: true },
    ],
  ])('offers none for %s', (_name, failure) => {
    expect(offersUpgrade(failure)).toBe(false)
  })
})
