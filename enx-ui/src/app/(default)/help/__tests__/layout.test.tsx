import { screen, within } from '@testing-library/react'
import HelpLayout from '../layout'
import { renderWithIntl } from '@/test-utils/intl'

jest.mock('@/auth/context', () => ({
  useAuthContext: () => ({ isLoaded: true, isSignedIn: false }),
}))

jest.mock('next/navigation', () =>
  jest.requireActual('@/test-utils/navigation')
)

it('keeps guides and the app reachable from the public help shell', async () => {
  // The shell's header and footer read UI messages (ADR-096).
  renderWithIntl(
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
