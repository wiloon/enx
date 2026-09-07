import { stampExtensionPresence } from '@/lib/extensionPresence'

const html = () => document.documentElement

beforeEach(() => {
  delete html().dataset.enxExtension
})

// ADR-019 Option G2: the content script marks its presence on enx-ui pages
// so the web app can detect "extension installed" even before an
// externally_connectable ping round-trips.
describe('stampExtensionPresence', () => {
  it('stamps the extension version on <html> on an enx-ui host', () => {
    stampExtensionPresence(
      document,
      { hostname: 'enx.wiloon.com', pathname: '/app' },
      '1.2.3'
    )
    expect(html().dataset.enxExtension).toBe('1.2.3')
  })

  it('also stamps on the dev and homelab hosts', () => {
    for (const hostname of ['localhost', 'enx.wiloon.lab']) {
      delete html().dataset.enxExtension
      stampExtensionPresence(document, { hostname, pathname: '/reader' }, '9')
      expect(html().dataset.enxExtension).toBe('9')
    }
  })

  it('does nothing on a host that is not enx-ui', () => {
    stampExtensionPresence(
      document,
      { hostname: 'www.infoq.com', pathname: '/articles/x' },
      '1.2.3'
    )
    expect(html().dataset.enxExtension).toBeUndefined()
  })
})
