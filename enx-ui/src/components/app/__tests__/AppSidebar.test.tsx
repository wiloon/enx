import { render, screen } from '@testing-library/react'
import AppSidebar from '../AppSidebar'
import { SITE } from '@/lib/site'

const mockPathname = jest.fn()
jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
}))

const mockUseIsAdmin = jest.fn()
jest.mock('@/hooks/useIsAdmin', () => ({
  useIsAdmin: () => mockUseIsAdmin(),
}))

// Covered in SidebarVersions.test.tsx; keeps these tests off the network.
jest.mock('../SidebarVersions', () => ({
  __esModule: true,
  default: () => null,
}))

beforeEach(() => {
  jest.clearAllMocks()
  mockUseIsAdmin.mockReturnValue({ isAdmin: false, isLoading: false })
})

it('renders every navigation destination', () => {
  mockPathname.mockReturnValue('/app')
  render(<AppSidebar />)

  for (const label of [
    'Home',
    'Word Lookup',
    'Rephrase',
    'Reader',
    'Reading Stats',
    'Settings',
    'Billing',
    'Invite friends',
    'Back to site',
  ]) {
    expect(screen.getByRole('link', { name: label })).toBeInTheDocument()
  }
})

// ADR-051 Decision 8: the invite page sits right after Billing.
it('lists Invite friends after Billing, linking to /invite', () => {
  mockPathname.mockReturnValue('/app')
  render(<AppSidebar />)

  const labels = screen.getAllByRole('link').map((l) => l.textContent?.trim())
  expect(labels.indexOf('Invite friends')).toBe(labels.indexOf('Billing') + 1)
  expect(screen.getByRole('link', { name: 'Invite friends' })).toHaveAttribute(
    'href',
    '/invite'
  )
})

// "Back to site" points at '/', which is a prefix of every route, so the
// generic prefix rule would light it up everywhere (ADR-027 decision 4).
it('never marks "Back to site" as the current page inside the app', () => {
  for (const pathname of ['/app', '/reader/history', '/billing']) {
    mockPathname.mockReturnValue(pathname)
    const { unmount } = render(<AppSidebar />)
    expect(
      screen.getByRole('link', { name: 'Back to site' })
    ).not.toHaveAttribute('aria-current')
    unmount()
  }
})

it('shows no pre-rename product names', () => {
  mockPathname.mockReturnValue('/app')
  render(<AppSidebar />)

  expect(screen.queryByText(/Catseye|ENX/)).not.toBeInTheDocument()
})

it('marks only the current route as active', () => {
  mockPathname.mockReturnValue('/rephrase')
  render(<AppSidebar />)

  expect(screen.getByRole('link', { name: 'Rephrase' })).toHaveAttribute(
    'aria-current',
    'page'
  )
  expect(screen.getByRole('link', { name: 'Home' })).not.toHaveAttribute(
    'aria-current'
  )
})

it('keeps a section active on its nested routes', () => {
  mockPathname.mockReturnValue('/stats/weekly')
  render(<AppSidebar />)

  expect(screen.getByRole('link', { name: 'Reading Stats' })).toHaveAttribute(
    'aria-current',
    'page'
  )
})

it('closes the drawer when a link is chosen', () => {
  mockPathname.mockReturnValue('/app')
  const onNavigate = jest.fn()
  render(<AppSidebar onNavigate={onNavigate} />)

  const link = screen.getByRole('link', { name: 'Word Lookup' })
  // jsdom can't navigate and logs an error when a click would; React's own
  // click handler still runs.
  link.addEventListener('click', (e) => e.preventDefault())
  link.click()
  expect(onNavigate).toHaveBeenCalled()
})

it('hides the Admin group for a non-admin', () => {
  mockPathname.mockReturnValue('/app')
  mockUseIsAdmin.mockReturnValue({ isAdmin: false, isLoading: false })
  render(<AppSidebar />)

  expect(screen.queryByText('Admin')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('link', { name: 'Dictionary' })
  ).not.toBeInTheDocument()
})

it('shows the Admin group for an admin', () => {
  mockPathname.mockReturnValue('/app')
  mockUseIsAdmin.mockReturnValue({ isAdmin: true, isLoading: false })
  render(<AppSidebar />)

  expect(screen.getByText('Admin')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Dictionary' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Page reports' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Users' })).toHaveAttribute(
    'href',
    '/admin/users'
  )
  expect(
    screen.getByRole('link', { name: 'AI definitions' })
  ).toBeInTheDocument()
})

it('marks the product as Beta and links to GitHub', () => {
  mockPathname.mockReturnValue('/app')
  render(<AppSidebar />)

  expect(screen.getByText('Beta')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'GitHub' })).toHaveAttribute(
    'href',
    SITE.githubUrl
  )
})
