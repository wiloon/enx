import { render, renderHook, screen } from '@testing-library/react'
import { useAuth } from '@/hooks/useAuth'
import HeaderAuthLinks from '@/components/site/HeaderAuthLinks'
import PricingCta from '@/components/site/PricingCta'
import ApiAuthBridge from '@/providers/ApiAuthBridge'
import RedirectToSignIn from '../RedirectToSignIn'
import ClerkAuthContext from '../clerk/ClerkAuthContext'
import { clerkAdapter } from '../clerk'
import { getAuthAdapter } from '..'
import { IntlWrapper } from '@/test-utils/intl'

// The Clerk SDK is the boundary here: these tests drive the real adapter,
// consumers and ApiService against doubles of Clerk's hooks and components.
const CLERK_ID = 'user_2abcClerkId'
const signOut = jest.fn()
const redirectToSignIn = jest.fn()
const getToken = jest.fn()
let mockAuth: { isLoaded: boolean; isSignedIn: boolean | undefined }

jest.mock('@clerk/nextjs', () => ({
  useAuth: () => ({ ...mockAuth, getToken }),
  useUser: () => ({
    user: mockAuth.isSignedIn
      ? {
          id: 'user_2abcClerkId',
          fullName: 'Alice Smith',
          username: null,
          primaryEmailAddress: { emailAddress: 'alice@example.com' },
        }
      : null,
  }),
  useClerk: () => ({ signOut, redirectToSignIn }),
  ClerkProvider: ({
    publishableKey,
    children,
  }: {
    publishableKey?: string
    children: React.ReactNode
  }) => (
    <div data-testid="clerk-provider" data-key={publishableKey ?? ''}>
      {children}
    </div>
  ),
  SignIn: ({ forceRedirectUrl }: { forceRedirectUrl?: string }) => (
    <div
      data-testid="clerk-sign-in"
      data-force-redirect={forceRedirectUrl ?? ''}
    />
  ),
  SignUp: () => <div data-testid="clerk-sign-up" />,
  RedirectToSignIn: () => <div data-testid="clerk-redirect" />,
}))

jest.mock('@clerk/nextjs/server', () => ({
  clerkMiddleware: jest.fn(),
}))

// The site's entry points also read UI messages (ADR-096).
const Intl = IntlWrapper()

function withClerk({ children }: { children: React.ReactNode }) {
  return (
    <Intl>
      <ClerkAuthContext>{children}</ClerkAuthContext>
    </Intl>
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  mockAuth = { isLoaded: true, isSignedIn: true }
})

describe('useAuth through the Clerk adapter', () => {
  it('does not hand out the Clerk ID (#211)', () => {
    const { result } = renderHook(() => useAuth(), { wrapper: withClerk })

    expect(result.current.user).toEqual({
      username: 'Alice Smith',
      email: 'alice@example.com',
      status: 'active',
      isLoggedIn: true,
    })
    expect(result.current.isAuthenticated).toBe(true)
    expect(result.current.isLoading).toBe(false)
    expect(JSON.stringify(result.current)).not.toContain(CLERK_ID)
  })

  it('reports loading and signed-out state', () => {
    mockAuth = { isLoaded: false, isSignedIn: undefined }
    const { result } = renderHook(() => useAuth(), { wrapper: withClerk })

    expect(result.current.isLoading).toBe(true)
    expect(result.current.isAuthenticated).toBe(false)
    expect(result.current.user).toBeNull()
  })

  it('signs out back to the marketing site', () => {
    const { result } = renderHook(() => useAuth(), { wrapper: withClerk })

    result.current.logout()
    expect(signOut).toHaveBeenCalledWith({ redirectUrl: '/' })
  })

  it('signs in through Clerk', () => {
    const { result } = renderHook(() => useAuth(), { wrapper: withClerk })

    result.current.signIn()
    expect(redirectToSignIn).toHaveBeenCalled()
  })
})

describe('site entry points through the Clerk adapter', () => {
  it('HeaderAuthLinks shows its loading status, then Sign in', () => {
    mockAuth = { isLoaded: false, isSignedIn: undefined }
    const { rerender } = render(<HeaderAuthLinks />, { wrapper: withClerk })
    expect(screen.getByRole('status')).toBeInTheDocument()

    mockAuth = { isLoaded: true, isSignedIn: false }
    rerender(<HeaderAuthLinks />)
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/app'
    )
  })

  it('HeaderAuthLinks links a signed-in visitor to the app', () => {
    render(<HeaderAuthLinks />, { wrapper: withClerk })
    expect(screen.getByRole('link', { name: /Go to app/ })).toHaveAttribute(
      'href',
      '/app'
    )
  })

  it('PricingCta sends a signed-out visitor to sign-up, then billing', () => {
    mockAuth = { isLoaded: true, isSignedIn: false }
    render(<PricingCta label="Start" />, { wrapper: withClerk })
    expect(screen.getByRole('link', { name: 'Start' })).toHaveAttribute(
      'href',
      '/sign-up?redirect_url=%2Fbilling'
    )
  })

  it('PricingCta sends a signed-in visitor to billing', () => {
    render(<PricingCta label="Start" />, { wrapper: withClerk })
    expect(screen.getByRole('link', { name: 'Start' })).toHaveAttribute(
      'href',
      '/billing'
    )
  })
})

describe('ApiAuthBridge through the Clerk adapter', () => {
  const realFetch = global.fetch
  afterEach(() => {
    global.fetch = realFetch
  })

  it('sends the Clerk session token as a Bearer header', async () => {
    getToken.mockResolvedValue('clerk-session-jwt')
    const fetchStub = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({}),
    })
    global.fetch = fetchStub as unknown as typeof fetch
    const { apiService } = await import('@/services/api')

    render(<ApiAuthBridge />, { wrapper: withClerk })
    await apiService.getMe()

    const [, init] = fetchStub.mock.calls[0]
    expect(init.headers.Authorization).toBe('Bearer clerk-session-jwt')
  })
})

describe('Clerk adapter pieces', () => {
  it('RedirectToSignIn renders Clerk’s redirect', () => {
    render(<RedirectToSignIn />, { wrapper: withClerk })
    expect(screen.getByTestId('clerk-redirect')).toBeInTheDocument()
  })

  it('Provider hands the runtime publishable key to ClerkProvider', () => {
    process.env.CLERK_PUBLISHABLE_KEY = 'pk_test_runtime'
    const { Provider } = clerkAdapter
    render(
      <Provider>
        <span>child</span>
      </Provider>
    )
    expect(screen.getByTestId('clerk-provider')).toHaveAttribute(
      'data-key',
      'pk_test_runtime'
    )
    expect(screen.getByText('child')).toBeInTheDocument()
    delete process.env.CLERK_PUBLISHABLE_KEY
  })

  it('SignInBody and SignUpBody render Clerk’s forms', () => {
    const { SignInBody, SignUpBody } = clerkAdapter
    render(
      <>
        <SignInBody forceRedirectUrl="/extension/connected" />
        <SignUpBody />
      </>
    )
    expect(screen.getByTestId('clerk-sign-in')).toHaveAttribute(
      'data-force-redirect',
      '/extension/connected'
    )
    expect(screen.getByTestId('clerk-sign-up')).toBeInTheDocument()
  })
})

describe('getAuthAdapter', () => {
  const saved = process.env.AUTH_PROVIDER
  afterEach(() => {
    if (saved === undefined) delete process.env.AUTH_PROVIDER
    else process.env.AUTH_PROVIDER = saved
  })

  it('selects Clerk when AUTH_PROVIDER is unset or "clerk"', () => {
    delete process.env.AUTH_PROVIDER
    expect(getAuthAdapter()).toBe(clerkAdapter)
    process.env.AUTH_PROVIDER = 'clerk'
    expect(getAuthAdapter()).toBe(clerkAdapter)
  })

  it('rejects an unsupported AUTH_PROVIDER', () => {
    process.env.AUTH_PROVIDER = 'logto'
    expect(() => getAuthAdapter()).toThrow(/AUTH_PROVIDER/)
  })
})
