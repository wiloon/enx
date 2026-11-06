import { render, screen, within } from '@testing-library/react'
import HelpLayout from '../layout'

jest.mock('@clerk/nextjs', () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: false }),
}))

it('keeps guides and the app reachable from the public help shell', async () => {
  render(
    <HelpLayout>
      <h1>Test guide</h1>
    </HelpLayout>
  )
  expect(
    within(screen.getByRole('main')).getByRole('heading', {
      name: 'Test guide',
    })
  ).toBeInTheDocument()
  await screen.findByRole('link', { name: 'Add to Chrome' })
  const nav = screen.getByRole('navigation', { name: 'Help guides' })
  expect(within(nav).getByRole('link', { name: 'Help home' })).toHaveAttribute(
    'href',
    '/help'
  )
  expect(
    within(nav).getByRole('link', { name: 'Manual installation' })
  ).toHaveAttribute('href', '/help/install/offline')
  expect(within(nav).getByRole('link', { name: 'Go to app' })).toHaveAttribute(
    'href',
    '/app'
  )
})
