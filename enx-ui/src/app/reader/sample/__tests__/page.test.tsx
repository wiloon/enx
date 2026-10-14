import { render, screen, waitFor } from '@testing-library/react'
import SampleArticlePage from '../page'
import { setRuntimeEnv } from '@/test/runtimeEnv'

beforeEach(() => {
  ;(global as unknown as { chrome?: unknown }).chrome = undefined
})

function installExtension() {
  setRuntimeEnv({ ENX_EXTENSION_ID: 'test-ext-id' })
  const sendMessage = jest.fn((_id, _m, cb) => cb({ ok: true, version: '1' }))
  ;(global as unknown as { chrome?: unknown }).chrome = {
    runtime: { sendMessage },
  }
  return sendMessage
}

it('offers the extension when it is not installed', async () => {
  setRuntimeEnv({
    ENX_EXTENSION_WEB_STORE_URL: 'https://chromewebstore.google.com/detail/enx',
  })
  render(<SampleArticlePage />)

  expect(
    await screen.findByRole('link', { name: 'Install the Catglish extension' })
  ).toHaveAttribute('href', 'https://chromewebstore.google.com/detail/enx')
})

it('does not offer the extension when it is installed', async () => {
  const sendMessage = installExtension()
  render(<SampleArticlePage />)

  await waitFor(() => expect(sendMessage).toHaveBeenCalled())
  expect(
    screen.queryByText(/Install the Catglish extension/)
  ).not.toBeInTheDocument()
})

it('asks the extension to enable learning mode on this tab', async () => {
  const sendMessage = installExtension()
  render(<SampleArticlePage />)

  await waitFor(() =>
    expect(sendMessage).toHaveBeenCalledWith(
      'test-ext-id',
      expect.objectContaining({ type: 'enx:enable-reader' }),
      expect.any(Function)
    )
  )
})

it('shows the sample article in the Reader article element, one paragraph per block', () => {
  const { container } = render(<SampleArticlePage />)

  expect(
    screen.getByRole('heading', {
      level: 1,
      name: 'The Quiet Power of a Short Walk',
    })
  ).toBeInTheDocument()
  const article = container.querySelector('article#enx-reader-article')
  const paragraphs = article?.querySelectorAll('p') ?? []
  expect(paragraphs).toHaveLength(4)
  expect(paragraphs[0]).toHaveTextContent(
    /^Most of us have had the experience: you're stuck on a problem/
  )
  expect(paragraphs[3]).toHaveTextContent(
    /let your feet do some of the work\.$/
  )
})
