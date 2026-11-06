import { render, screen } from '@testing-library/react'
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
  expect(screen.getByText(/Click the Catglish icon/)).toHaveTextContent(
    'Read with Catglish'
  )
  expect(screen.getByText(/Click a word you/)).toHaveTextContent('meaning')
  expect(screen.getAllByText(/Screenshot coming soon:/)).toHaveLength(3)
})
