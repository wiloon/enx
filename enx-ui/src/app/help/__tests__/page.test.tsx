import { render, screen } from '@testing-library/react'
import HelpPage from '../page'

it('offers installation and first-use guides without an account', () => {
  render(<HelpPage />)
  expect(
    screen.getByRole('heading', { level: 1, name: 'Help' })
  ).toBeInTheDocument()
  expect(
    screen.getByRole('link', { name: 'Install from the Chrome Web Store' })
  ).toHaveAttribute('href', '/help/install')
  expect(
    screen.getByRole('link', { name: 'Install manually from a ZIP file' })
  ).toHaveAttribute('href', '/help/install/offline')
  expect(
    screen.getByRole('link', { name: 'Get started with Catglish' })
  ).toHaveAttribute('href', '/help/get-started')
})

it('links Check setup to /welcome before the guides (ADR-047 #873)', () => {
  render(<HelpPage />)
  const links = screen.getAllByRole('link')
  expect(links[0]).toHaveAccessibleName('Check setup')
  expect(links[0]).toHaveAttribute('href', '/welcome')
})
