import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import SettingsPage from '../page'
import { apiService } from '@/services/api'
import type { PreferencesData } from '@/types'

jest.mock('@/services/api', () => ({
  apiService: {
    getPreferences: jest.fn(),
    updatePreferences: jest.fn(),
    getMe: jest.fn(),
    deleteMyAccount: jest.fn(),
  },
}))

const mockLogout = jest.fn()
jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    isLoading: false,
    logout: mockLogout,
  }),
}))

const api = apiService as jest.Mocked<typeof apiService>

const ack = { value: null, effective: false, editable: true }

const prefs = (
  aiWordFallback: PreferencesData['aiWordFallback']
): PreferencesData => ({ aiWordFallback, aiWordFallbackNoticeAck: ack })

const subscriber = prefs({ value: null, effective: true, editable: true })
const topupOnly = prefs({ value: null, effective: false, editable: true })
const free = prefs({ value: null, effective: false, editable: false })

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <SettingsPage />
    </QueryClientProvider>
  )
}

const aiSwitch = () =>
  screen.findByRole('switch', {
    name: 'Look up unknown words with AI automatically',
  })

beforeEach(() => {
  jest.resetAllMocks()
  api.getMe.mockResolvedValue({
    success: true,
    data: {
      id: 'u1',
      name: 'me',
      email: 'me@example.com',
      status: 'active',
      isAdmin: false,
    },
  })
})

it('shows the switch on for a subscriber, whose default is on', async () => {
  api.getPreferences.mockResolvedValue({ success: true, data: subscriber })
  renderPage()

  const toggle = await aiSwitch()
  expect(toggle).toHaveAttribute('aria-checked', 'true')
  expect(toggle).toBeEnabled()
})

it('shows the switch off but usable for a top-up-only user', async () => {
  api.getPreferences.mockResolvedValue({ success: true, data: topupOnly })
  renderPage()

  const toggle = await aiSwitch()
  expect(toggle).toHaveAttribute('aria-checked', 'false')
  expect(toggle).toBeEnabled()
})

it('disables the switch and points a free user at billing', async () => {
  api.getPreferences.mockResolvedValue({ success: true, data: free })
  renderPage()

  const toggle = await aiSwitch()
  expect(toggle).toBeDisabled()
  expect(toggle).toHaveAttribute('aria-checked', 'false')
  expect(
    screen.getByRole('link', { name: 'Subscribe or buy credits' })
  ).toHaveAttribute('href', '/billing')
})

it('does not offer billing to a user who can already use AI', async () => {
  api.getPreferences.mockResolvedValue({ success: true, data: subscriber })
  renderPage()
  await aiSwitch()

  expect(
    screen.queryByRole('link', { name: /Subscribe or buy credits/ })
  ).toBeNull()
})

it('saves an explicit choice and shows what the server answers', async () => {
  api.getPreferences.mockResolvedValue({ success: true, data: subscriber })
  api.updatePreferences.mockResolvedValue({
    success: true,
    data: prefs({ value: false, effective: false, editable: true }),
  })
  renderPage()

  fireEvent.click(await aiSwitch())

  await waitFor(() =>
    expect(api.updatePreferences).toHaveBeenCalledWith({
      aiWordFallback: false,
    })
  )
  await waitFor(async () =>
    expect(await aiSwitch()).toHaveAttribute('aria-checked', 'false')
  )
})

it('reverts and explains when saving fails', async () => {
  api.getPreferences.mockResolvedValue({ success: true, data: subscriber })
  api.updatePreferences.mockResolvedValue({
    success: false,
    error: 'This setting is available with a subscription or a credit balance.',
  })
  renderPage()

  fireEvent.click(await aiSwitch())

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'available with a subscription or a credit balance'
  )
  expect(await aiSwitch()).toHaveAttribute('aria-checked', 'true')
})

it('reports a failure to load the settings', async () => {
  api.getPreferences.mockResolvedValue({
    success: false,
    error: 'Session expired',
  })
  renderPage()

  expect(await screen.findByText('Session expired')).toBeInTheDocument()
  expect(screen.queryByRole('switch')).toBeNull()
})

describe('deleting the account (ADR-062)', () => {
  beforeEach(() => {
    api.getPreferences.mockResolvedValue({ success: true, data: subscriber })
  })

  const emailBox = () => screen.findByLabelText('Type your email to confirm')
  const deleteButton = () =>
    screen.getByRole('button', { name: 'Delete my account' })

  it('says what is lost and what to do first', async () => {
    renderPage()
    await emailBox()

    expect(
      screen.getByText(/remaining trial, subscription and top-up credits/)
    ).toBeInTheDocument()
    expect(
      screen.getByText(/will not get trial credits or invite rewards/)
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Refund Policy' })).toHaveAttribute(
      'href',
      '/refund'
    )
    expect(screen.getByRole('link', { name: 'Billing' })).toHaveAttribute(
      'href',
      '/billing'
    )
  })

  it('stays disabled until the account email is typed', async () => {
    renderPage()
    const box = await emailBox()
    expect(deleteButton()).toBeDisabled()

    fireEvent.change(box, { target: { value: 'you@example.com' } })
    expect(deleteButton()).toBeDisabled()

    fireEvent.change(box, { target: { value: ' Me@Example.com ' } })
    await waitFor(() => expect(deleteButton()).toBeEnabled())
  })

  it('deletes the account and signs out', async () => {
    api.deleteMyAccount.mockResolvedValue({
      success: true,
      data: { success: true },
    })
    renderPage()
    const box = await emailBox()
    fireEvent.change(box, { target: { value: 'me@example.com' } })
    await waitFor(() => expect(deleteButton()).toBeEnabled())

    fireEvent.click(deleteButton())

    await waitFor(() =>
      expect(api.deleteMyAccount).toHaveBeenCalledWith('me@example.com')
    )
    await waitFor(() => expect(mockLogout).toHaveBeenCalled())
  })

  it('shows why a deletion was refused and stays signed in', async () => {
    api.deleteMyAccount.mockResolvedValue({
      success: false,
      error:
        'Cancel your subscription on the Billing page before deleting your account.',
    })
    renderPage()
    const box = await emailBox()
    fireEvent.change(box, { target: { value: 'me@example.com' } })
    await waitFor(() => expect(deleteButton()).toBeEnabled())

    fireEvent.click(deleteButton())

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Cancel your subscription on the Billing page'
    )
    expect(mockLogout).not.toHaveBeenCalled()
  })
})

it('tells the user only the word is sent, not the sentence', async () => {
  api.getPreferences.mockResolvedValue({ success: true, data: subscriber })
  renderPage()
  await aiSwitch()

  expect(
    screen.getByText(/Only the word itself is sent to an AI provider/)
  ).toBeInTheDocument()
})
