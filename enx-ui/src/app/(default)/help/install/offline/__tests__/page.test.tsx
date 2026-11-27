import { render, screen } from '@testing-library/react'
import { SITE } from '@/lib/site'
import OfflineInstallPage from '../page'

jest.mock('@/lib/site', () => ({
  SITE: { ...jest.requireActual('@/lib/site').SITE },
}))
const original = { ...SITE }
afterEach(() => Object.assign(SITE, original))

it('takes users from GitHub release assets to loading an extracted extension', () => {
  render(<OfflineInstallPage />)
  expect(
    screen.getByRole('link', { name: 'Open the GitHub project' })
  ).toHaveAttribute('href', 'https://github.com/wiloon/enx')
  expect(
    screen.getByRole('link', { name: 'Open extension releases' })
  ).toHaveAttribute('href', 'https://github.com/wiloon/enx/releases')
  expect(screen.getByText('enx-<version>.zip')).toBeInTheDocument()
  expect(screen.getByText('catglish-<version>.zip')).toBeInTheDocument()
  expect(screen.getByText(/Do not download/)).toHaveTextContent('Source code')
  expect(screen.getByText(/Keep the extracted folder/)).toBeInTheDocument()
  expect(screen.getByText('chrome://extensions')).toBeInTheDocument()
  expect(screen.getByText(/Turn on/)).toHaveTextContent('Developer mode')
  expect(screen.getByText(/Click Load unpacked/)).toHaveTextContent(
    'manifest.json'
  )
  expect(screen.getByRole('link', { name: 'Continue setup' })).toHaveAttribute(
    'href',
    '/welcome'
  )
  expect(
    screen.getByText(/Manually installed extensions do not/)
  ).toHaveTextContent('update automatically')
  expect(screen.getAllByText(/Screenshot coming soon:/)).toHaveLength(3)
})

it('uses the configured repository and product names after a rename', () => {
  Object.assign(SITE, {
    githubUrl: 'https://github.com/wiloon/catglish',
    name: 'New Product',
  })
  render(<OfflineInstallPage />)
  expect(
    screen.getByRole('link', { name: 'Open the GitHub project' })
  ).toHaveAttribute('href', 'https://github.com/wiloon/catglish')
  expect(
    screen.getByRole('link', { name: 'Open extension releases' })
  ).toHaveAttribute('href', 'https://github.com/wiloon/catglish/releases')
  expect(screen.getByText('catglish-<version>.zip')).toBeInTheDocument()
  expect(screen.queryByText('enx-<version>.zip')).not.toBeInTheDocument()
  expect(screen.getByText(/This installs New Product/)).toBeInTheDocument()
})
