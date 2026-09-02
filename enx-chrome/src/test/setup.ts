import '@testing-library/jest-dom'
import { TextDecoder, TextEncoder } from 'util'
import { webcrypto } from 'crypto'

global.TextEncoder = TextEncoder as typeof global.TextEncoder
global.TextDecoder = TextDecoder as typeof global.TextDecoder
global.crypto = webcrypto as Crypto

// CSS Custom Highlight API shim (ADR-011): jsdom implements neither
// `Highlight` nor `CSS.highlights`. `Highlight` is a set of ranges;
// `CSS.highlights` is a maplike of name -> Highlight. The real objects
// carry rendering behaviour we can't exercise without layout, but the
// registry bookkeeping (which names hold which ranges) is testable.
class HighlightShim extends Set<Range> {
  priority = 0
  constructor(...ranges: Range[]) {
    super(ranges)
  }
}
if (typeof globalThis.Highlight === 'undefined') {
  globalThis.Highlight = HighlightShim as unknown as typeof Highlight
}
if (typeof globalThis.CSS === 'undefined') {
  globalThis.CSS = { highlights: new Map() } as unknown as typeof CSS
} else if (!globalThis.CSS.highlights) {
  globalThis.CSS.highlights = new Map() as unknown as HighlightRegistry
}

// Mock Chrome APIs
;(global as any).chrome = {
  runtime: {
    id: 'abcdefghijklmnopqrstuvwxyzabcdef',
    sendMessage: jest.fn(),
    lastError: undefined as { message: string } | undefined,
    onMessage: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
    },
    onInstalled: {
      addListener: jest.fn(),
    },
    getURL: jest.fn((path: string) => `chrome-extension://test/${path}`),
    getContexts: jest.fn(async () => []),
    ContextType: { SIDE_PANEL: 'SIDE_PANEL' },
  },
  identity: {
    launchWebAuthFlow: jest.fn(),
  },
  action: {
    onClicked: {
      addListener: jest.fn(),
    },
  },
  contextMenus: {
    create: jest.fn(),
    onClicked: {
      addListener: jest.fn(),
    },
  },
  sidePanel: {
    open: jest.fn(),
  },
  windows: {
    getCurrent: jest.fn(),
  },
  notifications: {
    create: jest.fn(),
    clear: jest.fn(),
    onClicked: {
      addListener: jest.fn(),
    },
  },
  storage: {
    local: {
      get: jest.fn(),
      set: jest.fn(),
      remove: jest.fn(),
      clear: jest.fn(),
    },
    session: {
      get: jest.fn(),
      set: jest.fn(),
      remove: jest.fn(),
    },
    sync: {
      get: jest.fn(),
      set: jest.fn(),
      remove: jest.fn(),
    },
    onChanged: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
    },
  },
  tabs: {
    query: jest.fn(),
    sendMessage: jest.fn(),
  },
} as any

if (!global.fetch) {
  global.fetch = jest.fn()
}
