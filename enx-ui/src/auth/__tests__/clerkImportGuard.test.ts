import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// ADR-036: Clerk is one adapter among several. Only src/auth/ may import
// @clerk/* or name it as a Jest mock target (test files included), so the rest
// of enx-ui depends on the provider-neutral interface alone.

const SRC = path.resolve(__dirname, '../..')
const SOURCE_FILE = /\.(ts|tsx|js|jsx|mjs|cjs)$/
const CLERK_REFERENCE =
  /(?:from\s*|import\s*\(\s*|require\s*\(\s*|jest\.(?:mock|doMock|unmock|requireActual|requireMock)\s*\(\s*)['"]@clerk\//

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') walk(p, acc)
    } else if (SOURCE_FILE.test(entry.name)) {
      acc.push(p)
    }
  }
  return acc
}

// Files under `root` outside `root/auth/` that reference an @clerk/* package.
function clerkOutsideAdapter(root: string): string[] {
  const adapter = path.join(root, 'auth') + path.sep
  return walk(root)
    .filter((f) => !f.startsWith(adapter))
    .filter((f) => CLERK_REFERENCE.test(readFileSync(f, 'utf8')))
    .map((f) => path.relative(root, f))
}

describe('Clerk adapter boundary', () => {
  it('keeps every @clerk/* import and mock target inside src/auth/', () => {
    expect(clerkOutsideAdapter(SRC)).toEqual([])
  })

  describe('the guard itself', () => {
    let root: string
    beforeEach(() => {
      root = mkdtempSync(path.join(os.tmpdir(), 'clerk-guard-'))
      mkdirSync(path.join(root, 'auth'))
      mkdirSync(path.join(root, 'components', '__tests__'), { recursive: true })
    })
    afterEach(() => rmSync(root, { recursive: true, force: true }))

    it('catches a forbidden import and a forbidden mock outside the adapter', () => {
      writeFileSync(
        path.join(root, 'components', 'Bad.tsx'),
        "import { useAuth } from '@clerk/nextjs'\n"
      )
      writeFileSync(
        path.join(root, 'components', '__tests__', 'bad.test.tsx'),
        "jest.mock('@clerk/nextjs/server', () => ({}))\n"
      )
      expect(clerkOutsideAdapter(root).sort()).toEqual([
        path.join('components', 'Bad.tsx'),
        path.join('components', '__tests__', 'bad.test.tsx'),
      ])
    })

    it('allows the adapter itself', () => {
      writeFileSync(
        path.join(root, 'auth', 'ok.ts'),
        "import { useAuth } from '@clerk/nextjs'\njest.mock('@clerk/nextjs')\n"
      )
      expect(clerkOutsideAdapter(root)).toEqual([])
    })
  })
})
