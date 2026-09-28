import { render, screen } from '@testing-library/react'
import SidebarVersions, { resetVersionCache } from '../SidebarVersions'
import { setRuntimeEnv } from '@/test/runtimeEnv'

const mockGetVersion = jest.fn()
jest.mock('@/services/api', () => ({
  apiService: { getVersion: () => mockGetVersion() },
}))

const mockDetectExtension = jest.fn()
jest.mock('@/lib/enxExtension', () => ({
  ...jest.requireActual('@/lib/enxExtension'),
  detectExtension: () => mockDetectExtension(),
}))

beforeEach(() => {
  jest.clearAllMocks()
  resetVersionCache()
  setRuntimeEnv({})
  mockGetVersion.mockResolvedValue({
    success: true,
    data: {
      version: 'v0.0.7',
      commit: 'e7e5cb6acd4f200d23325e977f04501404bb259c',
      build_time: 'unknown',
    },
  })
  mockDetectExtension.mockResolvedValue({ installed: false })
})

it('shows the product version with the short commit on hover', async () => {
  render(<SidebarVersions />)

  const line = await screen.findByText('Catglish v0.0.7')
  expect(line).toHaveAttribute('title', 'commit e7e5cb6')
})

it('adds the build time to the hover text when the API knows it', async () => {
  mockGetVersion.mockResolvedValue({
    success: true,
    data: {
      version: 'v0.0.8',
      commit: 'abcdef123',
      build_time: '2026-09-27T10:00:00Z',
    },
  })
  render(<SidebarVersions />)

  expect(await screen.findByText('Catglish v0.0.8')).toHaveAttribute(
    'title',
    'commit abcdef1 · built 2026-09-27T10:00:00Z'
  )
})

it('hides the product version when the API call fails', async () => {
  mockGetVersion.mockResolvedValue({ success: false, error: 'HTTP 502' })
  render(<SidebarVersions />)

  await screen.findByText('Extension not installed')
  expect(screen.queryByText(/Catglish/)).not.toBeInTheDocument()
})

it('fetches the version once across mounts', async () => {
  const { unmount } = render(<SidebarVersions />)
  await screen.findByText('Catglish v0.0.7')
  unmount()
  render(<SidebarVersions />)
  await screen.findByText('Catglish v0.0.7')

  expect(mockGetVersion).toHaveBeenCalledTimes(1)
})

it('shows the installed extension version', async () => {
  mockDetectExtension.mockResolvedValue({ installed: true, version: '1.0.1' })
  render(<SidebarVersions />)

  expect(await screen.findByText('Extension 1.0.1')).toBeInTheDocument()
})

it('links to the Web Store when the extension is missing and a store URL is set', async () => {
  setRuntimeEnv({
    ENX_EXTENSION_WEB_STORE_URL: 'https://store.example/catglish',
  })
  render(<SidebarVersions />)

  expect(
    await screen.findByRole('link', { name: 'Extension not installed →' })
  ).toHaveAttribute('href', 'https://store.example/catglish')
})
