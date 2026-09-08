import { render, screen } from '@testing-library/react'
import SignInPage from '../page'

// ADR-020: assert the post-sign-in redirect the page hands to Clerk's <SignIn>.
jest.mock('@clerk/nextjs', () => ({
  SignIn: ({ forceRedirectUrl }: { forceRedirectUrl?: string }) => (
    <div data-testid="sign-in" data-force-redirect={forceRedirectUrl ?? ''} />
  ),
}))

async function renderPage(searchParams: { src?: string }) {
  render(await SignInPage({ searchParams: Promise.resolve(searchParams) }))
  return screen.getByTestId('sign-in')
}

it('sends an extension-initiated sign-in to /extension/connected afterwards', async () => {
  const el = await renderPage({ src: 'extension' })
  expect(el).toHaveAttribute('data-force-redirect', '/extension/connected')
})

it('leaves the redirect to Clerk for a normal web sign-in', async () => {
  const el = await renderPage({})
  expect(el).toHaveAttribute('data-force-redirect', '')
})
