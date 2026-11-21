/**
 * @jest-environment node
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const SRC = join(__dirname, '..', '..', '..')
const ALLOWED = new Set([
  'lib/auth/clerk/workerAuth.ts',
  'lib/auth/clerk/popupAuth.tsx',
  'lib/auth/clerk/__tests__/clerkSessionSync.test.ts',
])

// The quoted module specifier, so static, side-effect, dynamic (including
// template literals), require and jest.requireActual loads all match.
const CLERK_SDK_SPECIFIER = /(['"`])@clerk\/chrome-extension(\/[^'"`]*)?\1/

function importsClerkSdk(source: string): boolean {
  return CLERK_SDK_SPECIFIER.test(source)
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (name === 'node_modules' || name === 'dist' || name === 'dist-production')
        continue
      walk(path, out)
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(path)
    }
  }
  return out
}

describe('auth adapter boundary', () => {
  it.each([
    ["import { ClerkProvider } from '@clerk/chrome-extension'"],
    ['import "@clerk/chrome-extension"'],
    ["const m = await import('@clerk/chrome-extension/background')"],
    ['const m = await import(`@clerk/chrome-extension/client`)'],
    ["const m = require('@clerk/chrome-extension')"],
    ["jest.requireActual('@clerk/chrome-extension/background')"],
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
      if (ALLOWED.has(rel)) continue
      // Tests that exercise the real SDK through the adapter may load it.
      if (rel.includes('__tests__/') || rel.includes('/test/')) continue
      // E2E helpers talk to Clerk's testing package, not the extension SDK.
      if (rel.startsWith('e2e/') || rel.includes('/e2e/')) continue
      const source = readFileSync(file, 'utf8')
      if (importsClerkSdk(source)) {
        offenders.push(rel)
      }
    }
    expect(offenders).toEqual([])
  })
})
