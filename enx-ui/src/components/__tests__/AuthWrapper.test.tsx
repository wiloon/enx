import { render, screen } from '@testing-library/react'

// Regression guard (ADR-015): a signed-out /app must REDIRECT to the /sign-in
// route, not render Clerk's <SignIn> inline. Inline <SignIn> at /app made Clerk
// derive /app/sso-callback as the OAuth return URL, which 404s.
jest.mock('@clerk/nextjs', () => ({
  RedirectToSignIn: () => <div data-testid="redirect-to-sign-in" />,
  SignIn: () => <div data-testid="inline-sign-in" />,
}))

const mockUseAuth = jest.fn()
jest.mock('@/hooks/useAuth', () => ({ useAuth: () => mockUseAuth() }))

import AuthWrapper from '../AuthWrapper'

describe('AuthWrapper auth gate', () => {
  it('redirects to the /sign-in route when signed out — never an inline <SignIn>', () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
      user: null,
      logout: jest.fn(),
    })

    render(<AuthWrapper />)

    expect(screen.getByTestId('redirect-to-sign-in')).toBeInTheDocument()
    expect(screen.queryByTestId('inline-sign-in')).not.toBeInTheDocument()
  })

  it('shows a loading state while Clerk is still resolving', () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: true,
      user: null,
      logout: jest.fn(),
    })

    render(<AuthWrapper />)

    expect(screen.getByText('Loading...')).toBeInTheDocument()
    expect(screen.queryByTestId('redirect-to-sign-in')).not.toBeInTheDocument()
  })

  it('renders the dashboard for a signed-in user', () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      user: { id: '1', username: 'alice', email: 'a@e.com', isLoggedIn: true },
      logout: jest.fn(),
    })

    render(<AuthWrapper />)

    expect(screen.getByRole('heading', { name: /welcome, alice/i })).toBeInTheDocument()
    expect(screen.queryByTestId('redirect-to-sign-in')).not.toBeInTheDocument()
  })
})
