import { render, screen, within } from '@testing-library/react'
import GetStartedPage from '../page'

it('explains pinning, sign-in and a user-initiated first lookup', () => {
  render(<GetStartedPage />)
  expect(
    screen.getByRole('heading', { level: 1, name: 'Get started with Catglish' })
  ).toBeInTheDocument()
  expect(screen.getByText(/Click the puzzle-piece/)).toHaveTextContent(
    'pin next to Catglish'
  )
  expect(screen.getByRole('link', { name: 'Open Welcome' })).toHaveAttribute(
    'href',
    '/welcome'
  )
  const signIn = screen.getByRole('link', { name: 'Open Welcome' })
    .parentElement as HTMLElement
  expect(signIn).toHaveTextContent(/choose Create free account if you are new/)
  expect(signIn).toHaveTextContent(/Sign in if you already have an account/)
  expect(within(signIn).getByText('Create free account').tagName).toBe('STRONG')
  expect(within(signIn).getByText('Sign in').tagName).toBe('STRONG')
  expect(signIn).not.toHaveTextContent('Continue')
  expect(screen.getByText(/Click the Catglish icon/)).toHaveTextContent(
    'Read with Catglish'
  )
  expect(screen.getByText(/Click a word you/)).toHaveTextContent('meaning')
  expect(screen.getAllByText(/Screenshot coming soon:/)).toHaveLength(3)
})
