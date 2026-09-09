import { render, screen } from '@testing-library/react'

const notFound = jest.fn(() => {
  throw new Error('NEXT_NOT_FOUND')
})
jest.mock('next/navigation', () => ({
  notFound: () => notFound(),
}))

const mockUseIsAdmin = jest.fn()
jest.mock('@/hooks/useIsAdmin', () => ({
  useIsAdmin: () => mockUseIsAdmin(),
}))

import AdminLayout from '../layout'

beforeEach(() => {
  jest.clearAllMocks()
})

it('renders children for an admin', () => {
  mockUseIsAdmin.mockReturnValue({ isAdmin: true, isLoading: false })
  render(<AdminLayout>admin content</AdminLayout>)
  expect(screen.getByText('admin content')).toBeInTheDocument()
  expect(notFound).not.toHaveBeenCalled()
})

it('calls notFound() for a non-admin', () => {
  mockUseIsAdmin.mockReturnValue({ isAdmin: false, isLoading: false })
  expect(() => render(<AdminLayout>admin content</AdminLayout>)).toThrow(
    'NEXT_NOT_FOUND'
  )
  expect(notFound).toHaveBeenCalled()
})

it('shows a spinner while the admin check is loading', () => {
  mockUseIsAdmin.mockReturnValue({ isAdmin: false, isLoading: true })
  const { container } = render(<AdminLayout>admin content</AdminLayout>)
  expect(screen.queryByText('admin content')).not.toBeInTheDocument()
  expect(notFound).not.toHaveBeenCalled()
  expect(container.querySelector('.animate-spin')).toBeInTheDocument()
})
