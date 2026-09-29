import {
  autoEnableSiteFor,
  isSitePattern,
  sitePatternFor,
} from '@/lib/autoEnableSite'

const manifest = {
  host_permissions: [
    'https://api.catglish.com/*',
    'https://catglish.com/*',
    'https://clerk.catglish.com/*',
  ],
  content_scripts: [{ matches: ['https://x.com/*'], js: ['assets/loader.js'] }],
}

describe('sitePatternFor (adr-039: exact origin, never a wildcard)', () => {
  it('turns a page URL into its exact-origin match pattern', () => {
    expect(sitePatternFor('https://www.infoq.com/news/2026/09/x/?a=1#b')).toBe(
      'https://www.infoq.com/*'
    )
  })

  it('keeps a non-default port as part of the origin', () => {
    expect(sitePatternFor('http://localhost:8080/post')).toBe(
      'http://localhost:8080/*'
    )
  })

  it.each([
    'chrome://extensions',
    'chrome-extension://abc/popup.html',
    'file:///tmp/a.html',
    'not a url',
    undefined,
  ])('returns null for %s', url => {
    expect(sitePatternFor(url)).toBeNull()
  })
})

describe('isSitePattern', () => {
  it('accepts an exact-origin pattern', () => {
    expect(isSitePattern('https://www.infoq.com/*')).toBe(true)
  })

  // Chrome's own site-access menu can hand out "all sites"; that must not
  // turn into "auto-enable everywhere".
  it.each(['https://*/*', 'http://*/*', '<all_urls>', 'https://*.infoq.com/*'])(
    'rejects the wildcard %s',
    pattern => {
      expect(isSitePattern(pattern)).toBe(false)
    }
  )

  it('rejects a path-scoped pattern', () => {
    expect(isSitePattern('https://claude.com/blog/*')).toBe(false)
  })
})

describe('autoEnableSiteFor', () => {
  it('offers an ordinary article site', () => {
    expect(autoEnableSiteFor('https://www.infoq.com/a', manifest)).toBe(
      'https://www.infoq.com/*'
    )
  })

  // Statically injected sites can still be auto-enabled (Decision 4).
  it('offers a statically injected site', () => {
    expect(autoEnableSiteFor('https://x.com/a/status/1', manifest)).toBe(
      'https://x.com/*'
    )
  })

  // A required host permission can't be removed, so the toggle could never
  // be turned off there -- and nobody reads articles on enx-ui/api anyway.
  it('does not offer a site the extension already holds a required permission for', () => {
    expect(
      autoEnableSiteFor('https://catglish.com/reader', manifest)
    ).toBeNull()
  })

  it('does not offer a non-web page', () => {
    expect(autoEnableSiteFor('chrome://newtab', manifest)).toBeNull()
  })
})
