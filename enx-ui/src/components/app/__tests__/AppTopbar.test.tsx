import { render, screen, fireEvent } from '@testing-library/react'
import AppTopbar from '../AppTopbar'

const mockPathname = jest.fn()
jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
}))

const logout = jest.fn()
jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { username: 'alice' }, logout }),
}))

beforeEach(() => {
  jest.clearAllMocks()
})

// The page's own heading (PageHeader) names the page; repeating it in the
// bar would show the title twice.
it('leaves the page title to the page', () => {
  mockPathname.mockReturnValue('/rephrase')
  render(<AppTopbar onOpenSidebar={jest.fn()} />)

  expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  expect(screen.queryByText('Rephrase')).not.toBeInTheDocument()
})

it('signs the user out', () => {
  mockPathname.mockReturnValue('/app')
  render(<AppTopbar onOpenSidebar={jest.fn()} />)

  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
  expect(logout).toHaveBeenCalled()
})

it('opens the mobile navigation drawer', () => {
  mockPathname.mockReturnValue('/app')
  const onOpenSidebar = jest.fn()
  render(<AppTopbar onOpenSidebar={onOpenSidebar} />)

  fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
  expect(onOpenSidebar).toHaveBeenCalled()
})
