import {
  FALLBACK_VERSION,
  isChromeVersion,
  isNewerVersion,
  versionFromDescribe,
  versionFromTag,
} from '../version'

describe('isChromeVersion', () => {
  it.each(['0', '1.0', '0.1.2', '1.2.3.4', '65535.0.0.65535'])(
    'accepts %s',
    version => {
      expect(isChromeVersion(version)).toBe(true)
    }
  )

  // Chrome takes 1-4 dot-separated integers, each 0-65535, no leading zeros
  // and no suffix: none of these upload.
  it.each([
    'v0.1.2',
    'e0.1.2',
    '0.1.2-beta',
    '01.2',
    '1.2.3.4.5',
    '65536.0',
    '1..2',
    '',
  ])('rejects %s', version => {
    expect(isChromeVersion(version)).toBe(false)
  })
})

describe('versionFromTag', () => {
  it('drops the chrome-v prefix', () => {
    expect(versionFromTag('chrome-v0.1.2')).toBe('0.1.2')
  })

  it('refuses an api/ui tag', () => {
    expect(() => versionFromTag('v0.1.2')).toThrow(/not an extension tag/)
  })

  it('refuses a tag whose version Chrome would reject', () => {
    expect(() => versionFromTag('chrome-v0.1.2-beta')).toThrow(
      /not a Chrome extension version/
    )
  })
})

describe('versionFromDescribe', () => {
  it('gives the tag version on the tagged commit', () => {
    expect(versionFromDescribe('chrome-v0.1.2-0-g1a2b3c4')).toBe('0.1.2')
  })

  it('counts commits past the tag in a fourth segment', () => {
    expect(versionFromDescribe('chrome-v0.1.2-5-g1a2b3c4\n')).toBe('0.1.2.5')
  })

  it('keeps a four-segment tag version as it is', () => {
    expect(versionFromDescribe('chrome-v0.1.2.3-5-g1a2b3c4')).toBe('0.1.2.3')
  })

  it('falls back when there is no chrome-v tag', () => {
    expect(versionFromDescribe(null)).toBe(FALLBACK_VERSION)
    expect(isChromeVersion(FALLBACK_VERSION)).toBe(true)
  })

  it('fails on output it does not understand', () => {
    expect(() => versionFromDescribe('chrome-v0.1.2')).toThrow(
      /Unexpected git describe output/
    )
  })

  it('fails on a bad tag rather than building with it', () => {
    expect(() => versionFromDescribe('chrome-v1.0-beta-2-g1a2b3c4')).toThrow(
      /not a Chrome extension version/
    )
  })
})

// The store refuses an upload that is not higher than the last one, so
// `task release` checks this before it pushes a tag.
describe('isNewerVersion', () => {
  it.each([
    ['0.1.2', '0.1.1'],
    ['0.1.10', '0.1.9'],
    ['0.2', '0.1.9.9'],
    ['1.0.0', '0.9'],
  ])('%s is newer than %s', (candidate, latest) => {
    expect(isNewerVersion(candidate, latest)).toBe(true)
  })

  it.each([
    ['0.1.1', '0.1.1'],
    ['0.1', '0.1.0'],
    ['0.1.9', '0.1.10'],
  ])('%s is not newer than %s', (candidate, latest) => {
    expect(isNewerVersion(candidate, latest)).toBe(false)
  })
})
