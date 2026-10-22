import { render, screen, fireEvent, within } from '@testing-library/react'
import AppTopbar from '../AppTopbar'
import type { MeData } from '@/types'

const mockPathname = jest.fn()
jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
}))

const logout = jest.fn()
jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ logout }),
}))

const mockUseMe = jest.fn()
jest.mock('@/hooks/useMe', () => ({
  useMe: () => mockUseMe(),
}))

const AVATAR = 'https://img.clerk.com/alice.png'

const me = (overrides: Partial<MeData> = {}): MeData => ({
  id: 'u_42',
  name: 'Alice Smith',
  email: 'alice@example.com',
  status: 'active',
  isAdmin: false,
  avatarUrl: AVATAR,
  createdAt: '2026-03-04T10:00:00Z',
  ...overrides,
})

const loaded = (data: MeData = me()) =>
  mockUseMe.mockReturnValue({ me: data, isLoading: false, error: null })

const trigger = () => screen.getByRole('button', { name: 'Account menu' })

// The picture is decorative (alt=""), so it has no img role to query by.
const picture = (el: HTMLElement) => el.querySelector('img')

// Radix opens a menu from the keyboard in jsdom; pointer events need layout.
function openMenu() {
  fireEvent.keyDown(trigger(), { key: 'Enter' })
  return screen.getByRole('menu')
}

beforeEach(() => {
  jest.clearAllMocks()
  mockPathname.mockReturnValue('/app')
  loaded()
})

// The page's own heading (PageHeader) names the page; repeating it in the
// bar would show the title twice.
it('leaves the page title to the page', () => {
  mockPathname.mockReturnValue('/rephrase')
  render(<AppTopbar onOpenSidebar={jest.fn()} />)

  expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  expect(screen.queryByText('Rephrase')).not.toBeInTheDocument()
})

it('opens the mobile navigation drawer', () => {
  const onOpenSidebar = jest.fn()
  render(<AppTopbar onOpenSidebar={onOpenSidebar} />)

  fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
  expect(onOpenSidebar).toHaveBeenCalled()
})

describe('account menu trigger', () => {
  it('shows the avatar and the name', () => {
    render(<AppTopbar onOpenSidebar={jest.fn()} />)

    const img = picture(trigger())
    expect(img).toHaveAttribute('src', AVATAR)
    expect(within(trigger()).getByText('Alice Smith')).toBeInTheDocument()
  })

  // Clerk's generated default avatar is a URL like any other.
  it('shows any non-empty avatar URL', () => {
    const generated = 'https://img.clerk.com/eyJ0eXBlIjoiZGVmYXVsdCJ9'
    loaded(me({ avatarUrl: generated }))
    render(<AppTopbar onOpenSidebar={jest.fn()} />)

    expect(picture(trigger())).toHaveAttribute('src', generated)
  })

  it('shows initials when there is no avatar', () => {
    loaded(me({ avatarUrl: '' }))
    render(<AppTopbar onOpenSidebar={jest.fn()} />)

    expect(picture(trigger())).not.toBeInTheDocument()
    expect(within(trigger()).getByText('AS')).toBeInTheDocument()
  })

  it('falls back to initials when the avatar fails to load', () => {
    render(<AppTopbar onOpenSidebar={jest.fn()} />)

    fireEvent.error(picture(trigger())!)

    expect(picture(trigger())).not.toBeInTheDocument()
    expect(within(trigger()).getByText('AS')).toBeInTheDocument()
  })
})

describe('account menu', () => {
  it('heads the menu with the avatar, name and email', () => {
    render(<AppTopbar onOpenSidebar={jest.fn()} />)

    const menu = openMenu()
    expect(within(menu).getByText('Alice Smith')).toBeInTheDocument()
    expect(within(menu).getByText('alice@example.com')).toBeInTheDocument()
    expect(picture(menu)).toHaveAttribute('src', AVATAR)
  })

  it('links to Account and Billing', () => {
    render(<AppTopbar onOpenSidebar={jest.fn()} />)

    const menu = openMenu()
    const items = within(menu)
      .getAllByRole('menuitem')
      .map((i) => i.textContent?.trim())
    expect(items).toEqual(['Account', 'Billing', 'Sign out'])
    expect(
      within(menu).getByRole('menuitem', { name: 'Account' })
    ).toHaveAttribute('href', '/account')
    expect(
      within(menu).getByRole('menuitem', { name: 'Billing' })
    ).toHaveAttribute('href', '/billing')
  })

  it('signs the user out', () => {
    render(<AppTopbar onOpenSidebar={jest.fn()} />)

    fireEvent.click(
      within(openMenu()).getByRole('menuitem', { name: 'Sign out' })
    )
    expect(logout).toHaveBeenCalled()
  })
})

// Signing out must never wait for enx-api: a slow or broken GET /api/me
// leaves placeholders, not a stuck menu.
describe.each([
  [
    'pending',
    { me: undefined, isLoading: true, error: null },
    'Loading your account…',
  ],
  [
    'failed',
    { me: undefined, isLoading: false, error: new Error('boom') },
    'Account details unavailable',
  ],
])('while GET /api/me is %s', (_state, result, headerText) => {
  beforeEach(() => mockUseMe.mockReturnValue(result))

  it('shows a placeholder avatar and no name on the trigger', () => {
    render(<AppTopbar onOpenSidebar={jest.fn()} />)

    expect(
      within(trigger()).getByTestId('account-avatar-placeholder')
    ).toBeInTheDocument()
    expect(trigger()).toHaveTextContent('')
  })

  it('shows a placeholder header and still signs out', () => {
    render(<AppTopbar onOpenSidebar={jest.fn()} />)

    const menu = openMenu()
    expect(within(menu).getByText(headerText)).toBeInTheDocument()
    expect(
      within(menu).getByTestId('account-avatar-placeholder')
    ).toBeInTheDocument()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Sign out' }))
    expect(logout).toHaveBeenCalled()
  })
})
