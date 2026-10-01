import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import AiWordFallbackSetting from '@/components/AiWordFallbackSetting'
import {
  fetchPreferences,
  readCachedPreferences,
  updatePreferences,
  type PreferencesData,
} from '@/lib/serverPreferences'

jest.mock('@/lib/serverPreferences', () => ({
  fetchPreferences: jest.fn(),
  updatePreferences: jest.fn(),
  readCachedPreferences: jest.fn(),
}))
jest.mock('@/config/env', () => ({
  config: { frontendBaseUrl: 'https://enx.example.test' },
}))

const fetchMock = fetchPreferences as jest.Mock
const updateMock = updatePreferences as jest.Mock
const cachedMock = readCachedPreferences as jest.Mock

const ack = { value: null, effective: false, editable: true }
const prefs = (
  aiWordFallback: PreferencesData['aiWordFallback']
): PreferencesData => ({ aiWordFallback, aiWordFallbackNoticeAck: ack })

const subscriber = prefs({ value: null, effective: true, editable: true })
const topupOnly = prefs({ value: null, effective: false, editable: true })
const free = prefs({ value: null, effective: false, editable: false })

const toggle = () => screen.findByTestId('ai-word-fallback-toggle')

beforeEach(() => {
  jest.resetAllMocks()
  cachedMock.mockResolvedValue(null)
})

it('shows a subscriber, whose default is on, as checked and editable', async () => {
  fetchMock.mockResolvedValue({ ok: true, data: subscriber })
  render(<AiWordFallbackSetting />)

  const box = await toggle()
  expect(box).toBeChecked()
  expect(box).toBeEnabled()
})

it('shows a top-up-only user as unchecked but editable', async () => {
  fetchMock.mockResolvedValue({ ok: true, data: topupOnly })
  render(<AiWordFallbackSetting />)

  const box = await toggle()
  expect(box).not.toBeChecked()
  expect(box).toBeEnabled()
})

it('disables the setting for a user who cannot use AI and links to billing', async () => {
  fetchMock.mockResolvedValue({ ok: true, data: free })
  render(<AiWordFallbackSetting />)

  expect(await toggle()).toBeDisabled()
  expect(
    screen.getByRole('link', { name: 'Subscribe / add credit' })
  ).toHaveAttribute('href', 'https://enx.example.test/billing')
})

it('does not offer billing to a user who can already use AI', async () => {
  fetchMock.mockResolvedValue({ ok: true, data: subscriber })
  render(<AiWordFallbackSetting />)
  await toggle()

  expect(screen.queryByRole('link', { name: /Subscribe/ })).toBeNull()
})

it('saves the choice and shows what the server answers', async () => {
  fetchMock.mockResolvedValue({ ok: true, data: subscriber })
  updateMock.mockResolvedValue({
    ok: true,
    data: prefs({ value: false, effective: false, editable: true }),
  })
  render(<AiWordFallbackSetting />)

  fireEvent.click(await toggle())

  await waitFor(() =>
    expect(updateMock).toHaveBeenCalledWith({ aiWordFallback: false })
  )
  await waitFor(async () => expect(await toggle()).not.toBeChecked())
})

it('keeps the current value and explains when saving fails', async () => {
  fetchMock.mockResolvedValue({ ok: true, data: subscriber })
  updateMock.mockResolvedValue({
    ok: false,
    reason: 'unavailable',
    error: 'Could not reach the server',
  })
  render(<AiWordFallbackSetting />)

  fireEvent.click(await toggle())

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Could not reach the server'
  )
  expect(await toggle()).toBeChecked()
})

it('asks a signed-out user to sign in instead of showing a switch', async () => {
  fetchMock.mockResolvedValue({
    ok: false,
    reason: 'signed-out',
    error: 'Not signed in',
  })
  render(<AiWordFallbackSetting />)

  expect(
    await screen.findByText(/Sign in from the Catglish toolbar/)
  ).toBeInTheDocument()
  expect(screen.queryByTestId('ai-word-fallback-toggle')).toBeNull()
})

it('shows the last known value, read-only, when the server is unreachable', async () => {
  fetchMock.mockResolvedValue({
    ok: false,
    reason: 'unavailable',
    error: 'Could not reach the server',
  })
  cachedMock.mockResolvedValue(subscriber)
  render(<AiWordFallbackSetting />)

  const box = await toggle()
  expect(box).toBeChecked()
  expect(box).toBeDisabled()
  expect(screen.getByText(/last value it gave this device/)).toBeInTheDocument()
})

it('says it could not load when the server is unreachable and nothing is cached', async () => {
  fetchMock.mockResolvedValue({
    ok: false,
    reason: 'unavailable',
    error: 'Could not reach the server',
  })
  render(<AiWordFallbackSetting />)

  expect(
    await screen.findByText(/Couldn.t load this setting/)
  ).toBeInTheDocument()
  expect(screen.queryByTestId('ai-word-fallback-toggle')).toBeNull()
})

it('tells the user only the word is sent, not the sentence', async () => {
  fetchMock.mockResolvedValue({ ok: true, data: subscriber })
  render(<AiWordFallbackSetting />)
  await toggle()

  expect(
    screen.getByText(/Only the word itself is sent to an AI provider/)
  ).toBeInTheDocument()
})
