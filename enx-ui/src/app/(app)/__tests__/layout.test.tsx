import { fireEvent, render, screen } from '@testing-library/react'

// Regression guard (ADR-015 / ADR-016): a signed-out visit to any app-area
// route must REDIRECT to the /sign-in route, never render Clerk's <SignIn>
// inline (that breaks the /sso-callback derivation).
jest.mock('@clerk/nextjs', () => ({
  RedirectToSignIn: () => <div data-testid="redirect-to-sign-in" />,
  SignIn: () => <div data-testid="inline-sign-in" />,
}))

const mockAccountDisabled = jest.fn(() => false)
jest.mock('@/hooks/useAccountDisabled', () => ({
  useAccountDisabled: () => mockAccountDisabled(),
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

// ADR-062 Decision 5: once enx-api says the account is disabled, the app
// shows that instead of pages that would keep calling it.
it('shows the disabled notice instead of the app for a disabled account', () => {
  const logout = jest.fn()
  mockUseAuth.mockReturnValue({
    isAuthenticated: true,
    isLoading: false,
    logout,
  })
  mockAccountDisabled.mockReturnValue(true)

  render(<AppLayout>protected content</AppLayout>)

  expect(
    screen.getByText('This account has been disabled.')
  ).toBeInTheDocument()
  expect(screen.queryByText('protected content')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
  expect(logout).toHaveBeenCalled()
})
