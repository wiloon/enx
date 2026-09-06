import { render, screen } from '@testing-library/react'

// Regression guard (ADR-015 / ADR-016): a signed-out visit to any app-area
// route must REDIRECT to the /sign-in route, never render Clerk's <SignIn>
// inline (that breaks the /sso-callback derivation).
jest.mock('@clerk/nextjs', () => ({
  RedirectToSignIn: () => <div data-testid="redirect-to-sign-in" />,
  SignIn: () => <div data-testid="inline-sign-in" />,
}))

jest.mock('@/components/app/AppShell', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-shell">{children}</div>
  ),
}))

const mockUseAuth = jest.fn()
jest.mock('@/hooks/useAuth', () => ({ useAuth: () => mockUseAuth() }))

import AppLayout from '../layout'

beforeEach(() => {
  jest.clearAllMocks()
})

it('redirects to /sign-in when signed out — never an inline <SignIn>', () => {
  mockUseAuth.mockReturnValue({ isAuthenticated: false, isLoading: false })

  render(<AppLayout>page</AppLayout>)

  expect(screen.getByTestId('redirect-to-sign-in')).toBeInTheDocument()
  expect(screen.queryByTestId('inline-sign-in')).not.toBeInTheDocument()
  expect(screen.queryByTestId('app-shell')).not.toBeInTheDocument()
})

it('shows a loading state while Clerk is still resolving', () => {
  mockUseAuth.mockReturnValue({ isAuthenticated: false, isLoading: true })

  render(<AppLayout>page</AppLayout>)

  expect(screen.getByText('Loading...')).toBeInTheDocument()
  expect(screen.queryByTestId('redirect-to-sign-in')).not.toBeInTheDocument()
})

it('renders the shell and children for a signed-in user', () => {
  mockUseAuth.mockReturnValue({ isAuthenticated: true, isLoading: false })

  render(<AppLayout>protected content</AppLayout>)

  expect(screen.getByTestId('app-shell')).toBeInTheDocument()
  expect(screen.getByText('protected content')).toBeInTheDocument()
})
