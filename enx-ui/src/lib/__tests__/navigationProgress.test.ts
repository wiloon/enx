import { shouldStartNavigationProgress } from '../navigationProgress'

const CURRENT = 'https://enx.example.com/pricing'

function click(overrides: {
  button?: number
  metaKey?: boolean
  ctrlKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
  href?: string
  target?: string
  download?: boolean
  noProgress?: boolean
  currentUrl?: string
} = {}) {
  return shouldStartNavigationProgress({
    button: overrides.button ?? 0,
    metaKey: overrides.metaKey ?? false,
    ctrlKey: overrides.ctrlKey ?? false,
    shiftKey: overrides.shiftKey ?? false,
    altKey: overrides.altKey ?? false,
    currentUrl: overrides.currentUrl ?? CURRENT,
    href: overrides.href ?? '/app',
    target: overrides.target ?? '',
    download: overrides.download ?? false,
    noProgress: overrides.noProgress ?? false,
  })
}

describe('shouldStartNavigationProgress', () => {
  it('accepts a same-origin path change', () => {
    expect(click({ href: '/app' })).toBe(true)
  })

  it('accepts a same-origin query-only change', () => {
    expect(click({ href: '/pricing?plan=pro' })).toBe(true)
  })

  it('rejects a modifier-key click', () => {
    expect(click({ metaKey: true })).toBe(false)
    expect(click({ ctrlKey: true })).toBe(false)
    expect(click({ shiftKey: true })).toBe(false)
    expect(click({ altKey: true })).toBe(false)
  })

  it('rejects a middle click', () => {
    expect(click({ button: 1 })).toBe(false)
  })

  it('rejects target="_blank"', () => {
    expect(click({ target: '_blank' })).toBe(false)
  })

  it('rejects a download link', () => {
    expect(click({ download: true })).toBe(false)
  })

  it('rejects an external link', () => {
    expect(click({ href: 'https://other.example.com/app' })).toBe(false)
  })

  it('rejects a hash-only link on the same page', () => {
    expect(click({ href: '#features' })).toBe(false)
    expect(
      click({
        currentUrl: 'https://enx.example.com/',
        href: '/#features',
      })
    ).toBe(false)
  })

  it('rejects a link to the current URL', () => {
    expect(click({ href: '/pricing' })).toBe(false)
    expect(click({ href: 'https://enx.example.com/pricing' })).toBe(false)
  })

  it('rejects an anchor with data-no-progress', () => {
    expect(click({ noProgress: true })).toBe(false)
  })
})
