/**
 * @jest-environment node
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const SRC = join(__dirname, '..', '..', '..')
// The quoted module specifier, so static, side-effect, dynamic (including
// template literals), require and jest.requireActual loads all match.
const CLERK_SDK_SPECIFIER = /(['"`])@clerk\/chrome-extension(\/[^'"`]*)?\1/

function importsClerkSdk(source: string): boolean {
  return CLERK_SDK_SPECIFIER.test(source)
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(path, out)
    } else if (entry.isFile()) {
      out.push(path)
    }
  }
  return out
}

describe('auth adapter boundary', () => {
  // Build the fixture specifiers so the source scan can include this test.
  const sdk = '@clerk/' + 'chrome-extension'

  it.each([
    [`import { ClerkProvider } from '${sdk}'`],
    [`import "${sdk}"`],
    [`const m = await import('${sdk}/background')`],
    ['const m = await import(`' + sdk + '/client`)'],
    [`const m = require('${sdk}')`],
    [`jest.requireActual('${sdk}/background')`],
  ])('detects the Clerk SDK in %s', source => {
    expect(importsClerkSdk(source)).toBe(true)
  })

  it.each([
    ["import { setupClerkTestingToken } from '@clerk/testing/playwright'"],
    ["import { useAuth } from '../lib/auth'"],
  ])('ignores %s', source => {
    expect(importsClerkSdk(source)).toBe(false)
  })

  it('keeps @clerk/chrome-extension imports inside the Clerk adapter', () => {
    const offenders: string[] = []
    for (const file of walk(SRC)) {
      const rel = relative(SRC, file)
      if (rel.startsWith('lib/auth/clerk/')) continue
      const source = readFileSync(file, 'utf8')
      if (importsClerkSdk(source)) {
        offenders.push(rel)
      }
    }
    expect(offenders).toEqual([])
  })
})
