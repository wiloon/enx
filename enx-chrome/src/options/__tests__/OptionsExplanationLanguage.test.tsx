import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import Options from '@/options/Options'
import {
  fetchPreferences,
  readCachedPreferences,
  updatePreferences,
  type PreferencesData,
  type PreferencesResult,
} from '@/lib/serverPreferences'

jest.mock('@/config/env', () => ({
  config: {
    apiBaseUrl: 'https://enx-api.wiloon.lab',
    frontendBaseUrl: 'https://enx.wiloon.lab',
    environment: 'homelab',
  },
}))
jest.mock('@/lib/sentry', () => ({ initSentry: jest.fn() }))
jest.mock('@/lib/serverPreferences', () => ({
  fetchPreferences: jest.fn(),
  updatePreferences: jest.fn(),
  readCachedPreferences: jest.fn(),
}))

const fetchMock = fetchPreferences as jest.Mock
const cacheMock = readCachedPreferences as jest.Mock
const updateMock = updatePreferences as jest.Mock

const flag = { value: null, effective: false, editable: true }

const prefs = (language?: string): PreferencesData => ({
  aiWordFallback: flag,
  aiWordFallbackNoticeAck: flag,
  ...(language
    ? {
        explanationLanguage: {
          value: language,
          effective: language,
          editable: true,
        },
      }
    : {}),
})
const ok = (language?: string): PreferencesResult => ({
  ok: true,
  data: prefs(language),
})
const unavailable: PreferencesResult = {
  ok: false,
  reason: 'unavailable',
  error: 'HTTP 500',
}

const dropdown = () =>
  screen.findByRole<HTMLSelectElement>('combobox', {
    name: 'Explanation language',
  })
const shown = (select: HTMLSelectElement) =>
  select.selectedOptions[0]?.textContent

// Waits for every setting on the page to finish loading.
const settled = () =>
  waitFor(() => expect(screen.queryAllByText('Loading...')).toHaveLength(0))

beforeEach(() => {
  jest.resetAllMocks()
  cacheMock.mockResolvedValue(null)
})

describe('Explanation language on the Options page (ADR-098)', () => {
  it('shows the server value and saves a change', async () => {
    fetchMock.mockResolvedValue(ok('zh-Hans'))
    updateMock.mockResolvedValue(ok('en'))
    render(<Options />)

    const select = await dropdown()
    expect(shown(select)).toBe('Simplified Chinese')
    expect([...select.options].map(o => o.textContent)).toEqual([
      'Simplified Chinese',
      'English',
    ])

    fireEvent.change(select, { target: { value: 'en' } })

    expect(updateMock).toHaveBeenCalledWith({ explanationLanguage: 'en' })
    expect(shown(select)).toBe('English')
    expect(select).toBeDisabled()
    await waitFor(() => expect(select).toBeEnabled())
    expect(shown(select)).toBe('English')
  })

  it('goes back and says so when saving fails', async () => {
    fetchMock.mockResolvedValue(ok('zh-Hans'))
    updateMock.mockResolvedValue(unavailable)
    render(<Options />)
    const select = await dropdown()

    fireEvent.change(select, { target: { value: 'en' } })

    expect(
      await screen.findByText("Couldn't save the explanation language.")
    ).toBeInTheDocument()
    expect(shown(select)).toBe('Simplified Chinese')
    expect(select).toBeEnabled()
  })

  it('selects no language for a value it does not know, and writes nothing', async () => {
    fetchMock.mockResolvedValue(ok('zh-Hant'))
    render(<Options />)

    const select = await dropdown()

    expect(select.value).toBe('')
    expect(shown(select)).toBe('')
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('shows the cached value, disabled, when the server cannot be reached', async () => {
    fetchMock.mockResolvedValue(unavailable)
    cacheMock.mockResolvedValue(prefs('en'))
    render(<Options />)

    const select = await dropdown()

    expect(shown(select)).toBe('English')
    expect(select).toBeDisabled()
  })

  it('says it could not load when there is nothing cached either', async () => {
    fetchMock.mockResolvedValue(unavailable)
    render(<Options />)
    await settled()

    expect(
      screen.getByRole('heading', { name: 'Explanations' })
    ).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(
      screen.getAllByText(/Couldn't load this setting/)
    ).toHaveLength(2)
  })

  it('asks a signed-out user to sign in', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      reason: 'signed-out',
      error: 'Not signed in',
    })
    render(<Options />)
    await settled()

    expect(screen.queryByRole('combobox')).toBeNull()
    expect(
      screen.getAllByText(/Sign in from the Catglish toolbar popup/)
    ).toHaveLength(2)
  })

  it('is not shown when the server does not send the preference', async () => {
    fetchMock.mockResolvedValue(ok())
    render(<Options />)
    await settled()

    expect(screen.queryByRole('combobox')).toBeNull()
    expect(
      screen.queryByRole('heading', { name: 'Explanations' })
    ).toBeNull()
  })
})
