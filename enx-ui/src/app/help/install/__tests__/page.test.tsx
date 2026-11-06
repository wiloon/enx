import { render, screen } from '@testing-library/react'
import InstallPage from '../page'

it('explains store search, the optional warning and permission confirmation before setup', () => {
  render(<InstallPage />)
  expect(screen.getByText(/Search for CATGLISH/)).toBeInTheDocument()
  expect(
    screen.getByRole('link', { name: 'Open the Chrome Web Store' })
  ).toHaveAttribute('href', 'https://chromewebstore.google.com/')
  expect(
    screen.getByRole('link', { name: 'Open the Catglish listing' })
  ).toHaveAttribute(
    'href',
    'https://chromewebstore.google.com/detail/catglish-learn-english-as/combdcldlodkikjfhjbdbogjlfmnbjkf'
  )
  expect(
    screen.getByText(/With Enhanced protection enabled, Chrome may show/)
  ).toHaveTextContent('To proceed, select “Continue to install”.')
  expect(screen.getByText(/In the permissions dialog/)).toHaveTextContent(
    'Add extension'
  )
  expect(screen.getByRole('link', { name: 'Continue setup' })).toHaveAttribute(
    'href',
    '/welcome'
  )
  expect(
    screen.getByRole('link', { name: 'Install manually from a ZIP file' })
  ).toHaveAttribute('href', '/help/install/offline')
  expect(screen.getAllByText(/Screenshot coming soon:/)).toHaveLength(4)
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
})
