import {
  stampExtensionPresence,
  stampLearningMode,
} from '@/lib/extensionPresence'
import type { PageLocation } from '@/lib/siteAdapters'

const html = () => document.documentElement

// The enx-ui origins each build is stamped with (targets.ts, #231).
const HOMELAB_UI = ['http://localhost:3000', 'https://enx.wiloon.lab']
const PRODUCTION_UI = ['https://catglish.com']

const at = (host: string, pathname = '/welcome'): PageLocation => ({
  host,
  hostname: host.split(':')[0],
  pathname,
})

beforeEach(() => {
  delete html().dataset.enxExtension
  delete html().dataset.enxLearning
})

// ADR-047 Decision 4a: /welcome ticks "Read with Catglish" when learning
// mode comes on in its own tab.
describe('stampLearningMode', () => {
  const welcome = at('catglish.com')

  it('marks <html data-enx-learning="on"> once learning mode is ready', () => {
    stampLearningMode(document, welcome, PRODUCTION_UI, { status: 'ready' })
    expect(html().getAttribute('data-enx-learning')).toBe('on')
  })

  it('removes the mark when learning mode is turned off', () => {
    stampLearningMode(document, welcome, PRODUCTION_UI, { status: 'ready' })
    stampLearningMode(document, welcome, PRODUCTION_UI, { status: 'off' })
    expect(html().hasAttribute('data-enx-learning')).toBe(false)
  })

  it('does not mark while the article is still being prepared', () => {
    stampLearningMode(document, welcome, PRODUCTION_UI, {
      status: 'processing',
    })
    expect(html().hasAttribute('data-enx-learning')).toBe(false)
  })

  it('never marks a page that is not enx-ui', () => {
    stampLearningMode(document, at('www.infoq.com'), PRODUCTION_UI, {
      status: 'ready',
    })
    expect(html().hasAttribute('data-enx-learning')).toBe(false)
  })

  // #231: the E2E fixture (localhost:8765) is an ordinary site even though
  // it shares localhost with the dev enx-ui.
  it('never marks an origin the build does not declare as enx-ui', () => {
    for (const host of ['localhost:8765', 'enx.wiloon.com']) {
      stampLearningMode(document, at(host), HOMELAB_UI, { status: 'ready' })
      expect(html().hasAttribute('data-enx-learning')).toBe(false)
    }
    stampLearningMode(document, at('localhost:3000'), PRODUCTION_UI, {
      status: 'ready',
    })
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
      at('catglish.com', '/app'),
      PRODUCTION_UI,
      '1.2.3'
    )
    expect(html().dataset.enxExtension).toBe('1.2.3')
  })

  it('stamps on every enx-ui host the build declares', () => {
    for (const host of ['localhost:3000', 'enx.wiloon.lab']) {
      delete html().dataset.enxExtension
      stampExtensionPresence(document, at(host, '/reader'), HOMELAB_UI, '9')
      expect(html().dataset.enxExtension).toBe('9')
    }
  })

  it('does nothing on a host that is not enx-ui', () => {
    stampExtensionPresence(
      document,
      at('www.infoq.com', '/articles/x'),
      PRODUCTION_UI,
      '1.2.3'
    )
    expect(html().dataset.enxExtension).toBeUndefined()
  })

  it('does nothing on another build’s host, another port or a lookalike', () => {
    for (const [host, uiOrigins] of [
      ['enx.wiloon.lab', PRODUCTION_UI],
      ['localhost:3000', PRODUCTION_UI],
      ['localhost:8765', HOMELAB_UI],
      ['enx.wiloon.com', HOMELAB_UI],
      ['catglish.com.evil.net', PRODUCTION_UI],
    ] as [string, string[]][]) {
      stampExtensionPresence(document, at(host), uiOrigins, '1.2.3')
      expect(html().dataset.enxExtension).toBeUndefined()
    }
  })
})
