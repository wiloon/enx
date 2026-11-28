import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  BACKGROUND_MESSAGE_NAMES,
  CONTENT_MESSAGE_NAMES,
} from '@/lib/messageContract'

// Until the listeners are registries typed from the contract (#1278, #1279),
// nothing but this test ties their switches to it: a `case` added to a
// listener without a contract entry, or the reverse, fails here.
const handledBy = (file: string): string[] => {
  const source = readFileSync(join(__dirname, '../..', file), 'utf8')
  const start = source.indexOf('chrome.runtime.onMessage.addListener(')
  expect(start).toBeGreaterThan(-1)
  const end = source.indexOf('\n})\n', start)
  expect(end).toBeGreaterThan(start)
  const listener = source.slice(start, end)
  return [...listener.matchAll(/^\s*case '([^']+)':/gm)].map(match => match[1])
}

const sorted = (names: readonly string[]) => [...names].sort()

it('declares every message the background listener handles, and no other', () => {
  expect(sorted(BACKGROUND_MESSAGE_NAMES)).toEqual(
    sorted(handledBy('background/background.ts'))
  )
})

it('declares every action the content script listener handles, and no other', () => {
  expect(sorted(CONTENT_MESSAGE_NAMES)).toEqual(
    sorted(handledBy('content/content.tsx'))
  )
})
