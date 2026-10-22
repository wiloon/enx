const { TextDecoder, TextEncoder, webcrypto } = require('util')

global.TextEncoder = TextEncoder
global.TextDecoder = TextDecoder
global.crypto = webcrypto

// jsdom has no IntersectionObserver. Without one, next/link schedules its
// prefetch visibility update on a requestIdleCallback timer, which lands after
// the test that rendered the link has finished.
if (typeof window !== 'undefined' && !window.IntersectionObserver) {
  window.IntersectionObserver = class IntersectionObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return []
    }
  }
}
