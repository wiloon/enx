import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

// Why this exists (ADR-015): Clerk derives its OAuth callback as
// `<mount path>/sso-callback`. If <SignIn> is mounted anywhere other than a
// catch-all route, that callback path has no Next route and 404s after the
// provider redirects back. This locks the invariant:
//   1. NEXT_PUBLIC_CLERK_SIGN_IN_URL resolves to a `[[...]]` catch-all route
//   2. <SignIn> / <SignUp> are only rendered inside those catch-all routes

const SRC = path.resolve(__dirname, '..')
const APP = path.join(SRC, 'app')

function routeDirForUrl(url: string): string {
  // "/sign-in" -> src/app/sign-in
  return path.join(APP, url.replace(/^\//, ''))
}

function hasOptionalCatchAll(dir: string): boolean {
  if (!existsSync(dir)) return false
  return readdirSync(dir).some((e) => /^\[\[\.\.\..+\]\]$/.test(e))
}

describe('Clerk sign-in/up routing contract', () => {
  const signInUrl = process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL || '/sign-in'
  const signUpUrl = process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL || '/sign-up'

  it(`sign-in URL (${signInUrl}) is a catch-all route so /sso-callback resolves`, () => {
    const dir = routeDirForUrl(signInUrl)
    expect(existsSync(dir)).toBe(true)
    expect(hasOptionalCatchAll(dir)).toBe(true)
  })

  it(`sign-up URL (${signUpUrl}) is a catch-all route`, () => {
    const dir = routeDirForUrl(signUpUrl)
    expect(existsSync(dir)).toBe(true)
    expect(hasOptionalCatchAll(dir)).toBe(true)
  })

  it('the Clerk sign-in/up widgets are only rendered inside those catch-all routes', () => {
    const allowedRoots = [routeDirForUrl(signInUrl), routeDirForUrl(signUpUrl)]

    function walk(dir: string, acc: string[] = []): string[] {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__' && entry.name !== 'node_modules') walk(p, acc)
        } else if (/\.tsx$/.test(entry.name)) {
          acc.push(p)
        }
      }
      return acc
    }

    const stripComments = (code: string) =>
      code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

    const offenders = walk(SRC).filter((f) => {
      if (allowedRoots.some((root) => f.startsWith(root))) return false
      return /<(SignIn|SignUp)[\s/>]/.test(stripComments(readFileSync(f, 'utf8')))
    })

    expect(offenders).toEqual([])
  })
})
