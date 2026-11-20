import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import Options from '@/options/Options'

// A non-production build: the one where the old API server switch was shown.
jest.mock('@/config/env', () => ({
  config: {
    apiBaseUrl: 'https://enx-api.wiloon.lab',
    frontendBaseUrl: 'https://enx.wiloon.lab',
    environment: 'homelab',
  },
}))
jest.mock('@/lib/sentry', () => ({ initSentry: jest.fn() }))
jest.mock('@/lib/serverPreferences', () => ({
  fetchPreferences: jest.fn(async () => ({ ok: false })),
  updatePreferences: jest.fn(),
  readCachedPreferences: jest.fn(async () => null),
}))

it('shows the build environment and its API server', async () => {
  render(<Options />)

  expect(await screen.findByText('homelab')).toBeInTheDocument()
  expect(screen.getByText('https://enx-api.wiloon.lab')).toBeInTheDocument()
})

describe('sharing article choices (ADR-073)', () => {
  function storedSharing(initial?: boolean) {
    const data: Record<string, unknown> =
      initial === undefined ? {} : { 'enx-article-choice-sharing': initial }
    ;(chrome.storage.local.get as jest.Mock).mockImplementation(
      async (key: string) => (key in data ? { [key]: data[key] } : {})
    )
    ;(chrome.storage.local.set as jest.Mock).mockImplementation(
      async (items: Record<string, unknown>) => {
        Object.assign(data, items)
      }
    )
    return data
  }

  afterEach(() => {
    ;(chrome.storage.local.get as jest.Mock).mockReset()
    ;(chrome.storage.local.set as jest.Mock).mockReset()
  })

  it('is off until answered and turning it on writes the setting the popup asks about', async () => {
    const stored = storedSharing()
    render(<Options />)
    const toggle = await screen.findByRole('checkbox', {
      name: /Share my article choices/,
    })
    expect(toggle).not.toBeChecked()

    fireEvent.click(toggle)

    await waitFor(() =>
      expect(stored).toEqual({ 'enx-article-choice-sharing': true })
    )
    expect(toggle).toBeChecked()
  })

  it('shows an earlier yes, turns it off, and says what turning it off keeps', async () => {
    const stored = storedSharing(true)
    render(<Options />)
    const toggle = await screen.findByRole('checkbox', {
      name: /Share my article choices/,
    })
    await waitFor(() => expect(toggle).toBeChecked())
    expect(
      screen.getByText(/stops future sends.*remain until you delete your account/)
    ).toBeInTheDocument()

    fireEvent.click(toggle)

    await waitFor(() =>
      expect(stored).toEqual({ 'enx-article-choice-sharing': false })
    )
    expect(toggle).not.toBeChecked()
  })
})

describe('hover sentence translate (ADR-068)', () => {
  function storedPrefs(initial: Record<string, unknown> = {}) {
    const data: Record<string, unknown> = { ...initial }
    ;(chrome.storage.local.get as jest.Mock).mockImplementation(
      async (key: string) => (key in data ? { [key]: data[key] } : {})
    )
    ;(chrome.storage.local.set as jest.Mock).mockImplementation(
      async (items: Record<string, unknown>) => {
        Object.assign(data, items)
      }
    )
    return data
  }

  afterEach(() => {
    ;(chrome.storage.local.get as jest.Mock).mockReset()
    ;(chrome.storage.local.set as jest.Mock).mockReset()
  })

  it('defaults both switches on and disables shade when translate is off', async () => {
    storedPrefs()
    render(<Options />)
    const translate = await screen.findByTestId('hover-sentence-translate-toggle')
    const shade = screen.getByTestId('hover-sentence-shade-toggle')
    expect(translate).toBeChecked()
    expect(shade).toBeChecked()
    expect(shade).not.toBeDisabled()

    fireEvent.click(translate)
    await waitFor(() => expect(translate).not.toBeChecked())
    expect(shade).toBeDisabled()
  })

  it('persists the translate switch', async () => {
    const stored = storedPrefs()
    render(<Options />)
    const translate = await screen.findByTestId('hover-sentence-translate-toggle')
    fireEvent.click(translate)
    await waitFor(() =>
      expect(stored['enx-hover-sentence-translate-enabled']).toBe(false)
    )
  })
})

// The API server is fixed when the extension is built (#231).
it('offers no way to switch the API server', async () => {
  render(<Options />)
  await screen.findByText('homelab')

  expect(screen.queryByText(/API URL Configuration/i)).not.toBeInTheDocument()
  expect(screen.queryByLabelText(/API URL/i)).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: /Save|Reset to Default|Local|Lab/ })
  ).not.toBeInTheDocument()
})
