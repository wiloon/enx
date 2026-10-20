import {
  stampExtensionPresence,
  stampLearningMode,
} from '@/lib/extensionPresence'

const html = () => document.documentElement

beforeEach(() => {
  delete html().dataset.enxExtension
  delete html().dataset.enxLearning
})

// ADR-047 Decision 4a: /welcome ticks "Read with Catglish" when learning
// mode comes on in its own tab.
describe('stampLearningMode', () => {
  const welcome = {
    host: 'enx.wiloon.com',
    hostname: 'enx.wiloon.com',
    pathname: '/welcome',
  }

  it('marks <html data-enx-learning="on"> once learning mode is ready', () => {
    stampLearningMode(document, welcome, { status: 'ready' })
    expect(html().getAttribute('data-enx-learning')).toBe('on')
  })

  it('removes the mark when learning mode is turned off', () => {
    stampLearningMode(document, welcome, { status: 'ready' })
    stampLearningMode(document, welcome, { status: 'off' })
    expect(html().hasAttribute('data-enx-learning')).toBe(false)
  })

  it('does not mark while the article is still being prepared', () => {
    stampLearningMode(document, welcome, { status: 'processing' })
    expect(html().hasAttribute('data-enx-learning')).toBe(false)
  })

  it('never marks a page that is not enx-ui', () => {
    stampLearningMode(
      document,
      {
        host: 'www.infoq.com',
        hostname: 'www.infoq.com',
        pathname: '/articles/x',
      },
      { status: 'ready' }
    )
    expect(html().hasAttribute('data-enx-learning')).toBe(false)
  })
})

// ADR-019 Option G2: the content script marks its presence on enx-ui pages
// so the web app can detect "extension installed" even before an
// externally_connectable ping round-trips.
describe('stampExtensionPresence', () => {
  it('stamps the extension version on <html> on an enx-ui host', () => {
    stampExtensionPresence(
      document,
      { host: 'enx.wiloon.com', hostname: 'enx.wiloon.com', pathname: '/app' },
      '1.2.3'
    )
    expect(html().dataset.enxExtension).toBe('1.2.3')
  })

  it('also stamps on the dev and homelab hosts', () => {
    for (const host of ['localhost:3000', 'enx.wiloon.lab']) {
      delete html().dataset.enxExtension
      const hostname = host.split(':')[0]
      stampExtensionPresence(
        document,
        { host, hostname, pathname: '/reader' },
        '9'
      )
      expect(html().dataset.enxExtension).toBe('9')
    }
  })

  it('does nothing on a host that is not enx-ui', () => {
    stampExtensionPresence(
      document,
      {
        host: 'www.infoq.com',
        hostname: 'www.infoq.com',
        pathname: '/articles/x',
      },
      '1.2.3'
    )
    expect(html().dataset.enxExtension).toBeUndefined()
  })
})
