import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import AppTopbar from '../AppTopbar'
import { RUNTIME_ENV_GLOBAL } from '@/lib/runtimeEnv'

jest.mock('next/navigation', () => ({ usePathname: () => '/reader' }))
jest.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ logout: jest.fn() }) }))
jest.mock('@/hooks/useMe', () => ({
  useMe: () => ({ me: undefined, isLoading: false, error: null }),
}))

const CHROME_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'

function answer(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    json: async () => body,
  }
}

const SENT = answer(200, { success: true, recorded: true })

const fetchMock = jest.fn()

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue(SENT)
  global.fetch = fetchMock as unknown as typeof fetch
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(navigator, 'userAgent', 'get').mockReturnValue(CHROME_UA)
  ;(window as unknown as Record<string, unknown>)[RUNTIME_ENV_GLOBAL] = {
    ENX_VERSION: 'v1.6.0',
  }
  window.history.pushState({}, '', '/reader/AbC123dEf456GhI789jKl012?doc=1#p2')
})

afterEach(() => {
  jest.restoreAllMocks()
})

function openFeedback() {
  render(<AppTopbar onOpenSidebar={jest.fn()} />)
  fireEvent.keyDown(screen.getByRole('button', { name: 'Account menu' }), {
    key: 'Enter',
  })
  fireEvent.click(
    within(screen.getByRole('menu')).getByRole('menuitem', {
      name: 'Send feedback',
    })
  )
  return screen.getByRole('dialog', { name: 'Send feedback' })
}

const textbox = () => screen.getByRole('textbox', { name: 'Your feedback' })
const urlField = () => screen.getByRole('textbox', { name: 'Page URL' })
const sendButton = () => screen.getByRole('button', { name: /^send/i })
const type = (value: string) =>
  fireEvent.change(textbox(), { target: { value } })

function sentBody() {
  const [url, init] = fetchMock.mock.calls[0]
  expect(url).toBe('/api/feedback')
  expect(init.method).toBe('POST')
  return JSON.parse(init.body)
}

it('opens from the account menu with the cleaned page URL', () => {
  openFeedback()

  expect(urlField()).toHaveValue('http://localhost/reader/:redacted')
  expect(textbox()).toHaveValue('')
})

it('sends text feedback with the URL, the version and the browser only', async () => {
  openFeedback()
  type('The chart is empty.')
  fireEvent.click(sendButton())

  await screen.findByText('Thanks — feedback sent')
  expect(sentBody()).toEqual({
    kind: 'text',
    url: 'http://localhost/reader/:redacted',
    text: 'The chart is empty.',
    context: { appVersion: 'v1.6.0', browser: 'Chrome 142' },
    details: {},
  })
})

it('sends "unknown" as the version on a dev server', async () => {
  ;(window as unknown as Record<string, unknown>)[RUNTIME_ENV_GLOBAL] = {}
  openFeedback()
  type('hi')
  fireEvent.click(sendButton())

  await screen.findByText('Thanks — feedback sent')
  expect(sentBody().context).toEqual({
    appVersion: 'unknown',
    browser: 'Chrome 142',
  })
})

it('sends the URL the user edited', async () => {
  openFeedback()
  fireEvent.change(urlField(), {
    target: { value: 'https://catglish.com/lookup' },
  })
  type('hi')
  fireEvent.click(sendButton())

  await screen.findByText('Thanks — feedback sent')
  expect(sentBody().url).toBe('https://catglish.com/lookup')
})

it('sends an empty URL when the user cleared it', async () => {
  openFeedback()
  fireEvent.change(urlField(), { target: { value: '' } })
  type('hi')
  fireEvent.click(sendButton())

  await screen.findByText('Thanks — feedback sent')
  expect(sentBody().url).toBe('')
})

it('resets the text and the URL after a successful send', async () => {
  openFeedback()
  fireEvent.change(urlField(), { target: { value: '' } })
  type('hi')
  fireEvent.click(sendButton())

  await screen.findByText('Thanks — feedback sent')
  expect(textbox()).toHaveValue('')
  expect(urlField()).toHaveValue('http://localhost/reader/:redacted')
})

it.each([
  ['empty', ''],
  ['whitespace-only', '  \n\t '],
])('cannot send %s text', (_name, value) => {
  openFeedback()
  type(value)

  expect(sendButton()).toBeDisabled()
  fireEvent.click(sendButton())
  expect(fetchMock).not.toHaveBeenCalled()
})

it('sends once for a double click and is disabled while in flight', async () => {
  let resolve: (v: unknown) => void = () => {}
  fetchMock.mockReturnValue(new Promise((r) => (resolve = r)))
  openFeedback()
  type('hi')
  fireEvent.click(sendButton())
  fireEvent.click(sendButton())

  expect(sendButton()).toBeDisabled()
  await waitFor(() => expect(fetchMock).toHaveBeenCalled())
  resolve(SENT)
  await screen.findByText('Thanks — feedback sent')
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

it.each([
  [
    429,
    {
      success: false,
      code: 'feedback_limit_exceeded',
      message: 'Daily feedback limit reached. Please try again tomorrow.',
    },
    'Daily feedback limit reached. Please try again tomorrow.',
  ],
  [
    400,
    { success: false, message: 'invalid feedback: bad page URL' },
    'invalid feedback: bad page URL',
  ],
  [
    500,
    { success: false, message: 'database is locked' },
    'Could not send the feedback. Please try again.',
  ],
])(
  'shows the message for a %i answer and keeps the text',
  async (status, body, message) => {
    fetchMock.mockResolvedValue(answer(status, body))
    openFeedback()
    type('hi')
    fireEvent.click(sendButton())

    expect(await screen.findByRole('alert')).toHaveTextContent(
      new RegExp(`^${message}$`)
    )
    expect(textbox()).toHaveValue('hi')
  }
)

it('shows the fallback for a network error and keeps the text', async () => {
  fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
  openFeedback()
  type('hi')
  fireEvent.click(sendButton())

  expect(await screen.findByRole('alert')).toHaveTextContent(
    /^Could not send the feedback\. Please try again\.$/
  )
  expect(textbox()).toHaveValue('hi')
})

it('counts the characters left and stops input at 2000', () => {
  openFeedback()
  expect(screen.getByText('2,000 characters left')).toBeInTheDocument()

  type('😀'.repeat(1990))
  expect(screen.getByText('10 characters left')).toBeInTheDocument()

  type('😀'.repeat(2001))
  expect(textbox()).toHaveValue('😀'.repeat(2000))
  expect(screen.getByText('0 characters left')).toBeInTheDocument()
  expect(sendButton()).toBeEnabled()
})

it('closes without sending', async () => {
  openFeedback()
  type('hi')
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))

  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(fetchMock).not.toHaveBeenCalled()
})
