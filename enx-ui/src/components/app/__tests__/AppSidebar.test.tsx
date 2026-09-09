import { render, screen } from '@testing-library/react'
import AppSidebar from '../AppSidebar'

const mockPathname = jest.fn()
jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
}))

const mockUseIsAdmin = jest.fn()
jest.mock('@/hooks/useIsAdmin', () => ({
  useIsAdmin: () => mockUseIsAdmin(),
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
    'Billing',
  ]) {
    expect(screen.getByRole('link', { name: label })).toBeInTheDocument()
  }
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

  screen.getByRole('link', { name: 'Word Lookup' }).click()
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
})
