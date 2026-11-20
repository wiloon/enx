import {
  existsSync,
  readdirSync,
  readFileSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Why this exists (ADR-015): Clerk derives its OAuth callback as
// `<mount path>/sso-callback`. If <SignIn> is mounted anywhere other than a
// catch-all route, that callback path has no Next route and 404s after the
// provider redirects back. This locks the invariant:
//   1. NEXT_PUBLIC_CLERK_SIGN_IN_URL resolves to a `[[...]]` catch-all route
//   2. <SignIn> / <SignUp> are only rendered inside those catch-all routes

const SRC = path.resolve(__dirname, '..')
const APP = path.join(SRC, 'app')
const OPTIONAL_CATCH_ALL = /^\[\[\.\.\..+\]\]$/

function routeDirForUrl(url: string): string {
  // "/sign-in" -> src/app/sign-in
  return path.join(APP, url.replace(/^\//, ''))
}

function hasOptionalCatchAll(dir: string): boolean {
  if (!existsSync(dir)) return false
  return readdirSync(dir).some((e) => OPTIONAL_CATCH_ALL.test(e))
}

function isCatchAllPage(file: string, route: string): boolean {
  const [segment, page, ...rest] = path.relative(route, file).split(path.sep)
  return (
    OPTIONAL_CATCH_ALL.test(segment) && page === 'page.tsx' && rest.length === 0
  )
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
    expect(
      widgetOffenders(SRC, routeDirForUrl(signInUrl), routeDirForUrl(signUpUrl))
    ).toEqual([])
  })
})

function widgetOffenders(
  src: string,
  signInRoute: string,
  signUpRoute: string
): string[] {
  function walk(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__' && entry.name !== 'node_modules')
          walk(p, acc)
      } else if (/\.tsx$/.test(entry.name)) {
        acc.push(p)
      }
    }
    return acc
  }

  const stripComments = (code: string) =>
    code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

  const widgetBodies = path.join(src, 'auth', 'clerk', 'ClerkAuthWidgets.tsx')
  return walk(src).filter((f) => {
    const code = stripComments(readFileSync(f, 'utf8'))
    if (/<SignInBody[\s/>]/.test(code) && !isCatchAllPage(f, signInRoute))
      return true
    if (/<SignUpBody[\s/>]/.test(code) && !isCatchAllPage(f, signUpRoute))
      return true
    return f !== widgetBodies && /<(SignIn|SignUp)[\s/>]/.test(code)
  })
}

describe('the routing guard itself', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'clerk-routing-'))
  })

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  function fixture(relativePath: string, code: string): string {
    const file = path.join(root, relativePath)
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, code)
    return file
  }

  function offenders(): string[] {
    return widgetOffenders(
      root,
      path.join(root, 'app', 'sign-in'),
      path.join(root, 'app', 'sign-up')
    )
  }

  it('reports a sign-in body mounted on a similarly named ordinary route', () => {
    const offender = fixture(
      'app/sign-in-preview/page.tsx',
      'const page = <SignInBody />'
    )

    expect(offenders()).toEqual([offender])
  })

  it('reports a Clerk widget mounted by the root auth provider', () => {
    const offender = fixture(
      'auth/clerk/index.tsx',
      'const Provider = () => <SignIn />'
    )

    expect(offenders()).toEqual([offender])
  })
})
