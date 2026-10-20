import { render, screen } from '@testing-library/react'
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
