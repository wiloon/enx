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

it('shows the current page title from the nav config', () => {
  mockPathname.mockReturnValue('/rephrase')
  render(<AppTopbar onOpenSidebar={jest.fn()} />)

  expect(screen.getByRole('heading', { name: 'Rephrase' })).toBeInTheDocument()
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
