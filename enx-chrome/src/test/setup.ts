import '@testing-library/jest-dom'
import { TextDecoder, TextEncoder } from 'util'
import { webcrypto } from 'crypto'

global.TextEncoder = TextEncoder as typeof global.TextEncoder
global.TextDecoder = TextDecoder as typeof global.TextDecoder
global.crypto = webcrypto as Crypto

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
    getURL: jest.fn((path: string) => `chrome-extension://test/${path}`),
  },
  identity: {
    launchWebAuthFlow: jest.fn(),
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
  },
  tabs: {
    query: jest.fn(),
    sendMessage: jest.fn(),
  },
} as any

if (!global.fetch) {
  global.fetch = jest.fn()
}
