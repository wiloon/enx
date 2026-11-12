import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import SendFeedback from '../SendFeedback'

const CHROME_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'
const NO_RECEIVER = new Error(
  'Could not establish connection. Receiving end does not exist.'
)

const runtimeSend = chrome.runtime.sendMessage as jest.Mock
const tabSend = chrome.tabs.sendMessage as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(navigator, 'userAgent', 'get').mockReturnValue(CHROME_UA)
  ;(chrome.tabs.query as jest.Mock).mockResolvedValue([
    {
      id: 7,
      url: 'https://user:pw@example.com/news/jane@example.com/story?id=1#top',
      title: 'A secret title',
    },
  ])
  tabSend.mockResolvedValue({
    learningMode: true,
    adapter: 'default',
    articleSource: 'auto',
  })
  runtimeSend.mockResolvedValue({ success: true, data: { recorded: true } })
})

afterEach(() => {
  jest.restoreAllMocks()
})

const open = async () => {
  render(
    <SendFeedback>
      <p>Main page</p>
    </SendFeedback>
  )
  fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }))
  return {
    text: screen.getByRole('textbox', { name: 'Your feedback' }),
    url: await screen.findByRole('textbox', { name: 'Page URL' }),
    send: screen.getByRole('button', { name: 'Send' }),
  }
}

const type = (box: HTMLElement, value: string) =>
  fireEvent.change(box, { target: { value } })

const sentFeedback = () => {
  const calls = runtimeSend.mock.calls.filter(
    ([message]) => message.type === 'submitFeedback'
  )
  return calls.map(([message]) => message.feedback)
}

it('opens the feedback page in place of the main page, and Back returns to it', async () => {
  await open()
  expect(screen.queryByText('Main page')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Back' }))
  expect(screen.getByText('Main page')).toBeInTheDocument()
  expect(
    screen.queryByRole('textbox', { name: 'Your feedback' })
  ).not.toBeInTheDocument()
})

it('opens with the cleaned page URL of the current tab', async () => {
  const { url } = await open()
  await waitFor(() =>
    expect(url).toHaveValue('https://example.com/news/:redacted/story')
  )
})

it('sends the text, the cleaned URL and the page context, nothing from the page itself', async () => {
  const { text, url, send } = await open()
  await waitFor(() => expect(url).not.toHaveValue(''))
  type(text, 'The popover hides the word')
  fireEvent.click(send)

  await waitFor(() => expect(sentFeedback()).toHaveLength(1))
  expect(runtimeSend).toHaveBeenCalledWith({
    type: 'submitFeedback',
    feedback: {
      text: 'The popover hides the word',
      url: 'https://example.com/news/:redacted/story',
      context: {
        browser: 'Chrome 142',
        learningMode: true,
        adapter: 'default',
        articleSource: 'auto',
      },
    },
  })
  expect(tabSend).toHaveBeenCalledWith(
    7,
    { action: 'getFeedbackContext' },
    { frameId: 0 }
  )
})

it.each([
  ['edited', 'https://example.com/other', 'https://example.com/other'],
  ['cleared', '', ''],
])('sends the URL the user %s', async (_name, typed, expected) => {
  const { text, url, send } = await open()
  await waitFor(() => expect(url).not.toHaveValue(''))
  type(url, typed)
  type(text, 'hi')
  fireEvent.click(send)

  await waitFor(() => expect(sentFeedback()).toHaveLength(1))
  expect(sentFeedback()[0].url).toBe(expected)
})

it('starts with no URL on a tab that is not a web page, and still sends', async () => {
  ;(chrome.tabs.query as jest.Mock).mockResolvedValue([
    { id: 7, url: 'chrome://newtab/' },
  ])
  const { text, url, send } = await open()
  await act(async () => {
    await (chrome.tabs.query as jest.Mock).mock.results[0].value
  })
  expect(url).toHaveValue('')
  type(text, 'hi')
  fireEvent.click(send)

  await waitFor(() => expect(sentFeedback()).toHaveLength(1))
  expect(sentFeedback()[0].url).toBe('')
  expect(tabSend).toHaveBeenCalledWith(
    7,
    { action: 'getFeedbackContext' },
    { frameId: 0 }
  )
})

it('keeps a cleared URL when the user goes back and opens it again', async () => {
  const { url } = await open()
  await waitFor(() => expect(url).not.toHaveValue(''))
  type(url, '')
  fireEvent.click(screen.getByRole('button', { name: 'Back' }))
  fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }))
  const reopened = await screen.findByRole('textbox', { name: 'Page URL' })
  await act(async () => {})
  expect(reopened).toHaveValue('')
  type(screen.getByRole('textbox', { name: 'Your feedback' }), 'hi')
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))

  await waitFor(() => expect(sentFeedback()).toHaveLength(1))
  expect(sentFeedback()[0].url).toBe('')
})

it('sends learningMode false and injects nothing when the tab has no content script', async () => {
  tabSend.mockRejectedValue(NO_RECEIVER)
  const { text, send } = await open()
  type(text, 'hi')
  fireEvent.click(send)

  await waitFor(() => expect(sentFeedback()).toHaveLength(1))
  expect(sentFeedback()[0].context).toEqual({
    browser: 'Chrome 142',
    learningMode: false,
  })
  expect(chrome.scripting.executeScript).not.toHaveBeenCalled()
})

it('cannot send empty or whitespace-only text', async () => {
  const { text, send } = await open()
  expect(send).toBeDisabled()
  type(text, ' \n ')
  expect(send).toBeDisabled()
  type(text, ' a ')
  expect(send).toBeEnabled()
})

it('counts the characters left and stops input at 2000', async () => {
  const { text } = await open()
  expect(screen.getByText('2,000 characters left')).toBeInTheDocument()
  type(text, 'hello')
  expect(screen.getByText('1,995 characters left')).toBeInTheDocument()
  type(text, '😀'.repeat(2001))
  expect(text).toHaveValue('😀'.repeat(2000))
  expect(screen.getByText('0 characters left')).toBeInTheDocument()
})

it('sends once for a double click and is disabled while in flight', async () => {
  let answer: (value: unknown) => void = () => {}
  runtimeSend.mockReturnValue(new Promise(resolve => (answer = resolve)))
  const { text, send } = await open()
  type(text, 'hi')
  fireEvent.click(send)
  fireEvent.click(send)

  await waitFor(() => expect(sentFeedback()).toHaveLength(1))
  expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled()
  answer({ success: true })
  await screen.findByText('Main page')
  expect(sentFeedback()).toHaveLength(1)
})

it('goes back to the main page with a thank-you toast that disappears after 3 seconds', async () => {
  const { text, url, send } = await open()
  await waitFor(() => expect(url).not.toHaveValue(''))
  jest.useFakeTimers()
  try {
    type(text, 'hi')
    fireEvent.click(send)

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Thanks — feedback sent'
    )
    expect(screen.getByText('Main page')).toBeInTheDocument()
    act(() => jest.advanceTimersByTime(2_900))
    expect(screen.getByRole('status')).toHaveTextContent('Thanks')
    act(() => jest.advanceTimersByTime(200))
    expect(screen.queryByText('Thanks — feedback sent')).not.toBeInTheDocument()
  } finally {
    jest.useRealTimers()
  }
})

it('starts again with empty text and the page URL after a successful send', async () => {
  const { text, url, send } = await open()
  await waitFor(() => expect(url).not.toHaveValue(''))
  type(url, 'https://example.com/other')
  type(text, 'hi')
  fireEvent.click(send)

  await screen.findByText('Main page')
  fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }))
  expect(screen.getByRole('textbox', { name: 'Your feedback' })).toHaveValue('')
  expect(screen.getByRole('textbox', { name: 'Page URL' })).toHaveValue(
    'https://example.com/news/:redacted/story'
  )
})

it.each([
  [400, 'invalid feedback: url "foo" is not a web page'],
  [429, 'Daily feedback limit reached. Please try again tomorrow.'],
])(
  "shows the API's message for a %i and keeps the text",
  async (status, error) => {
    runtimeSend.mockResolvedValue({ success: false, status, error })
    const { text, send } = await open()
    type(text, 'hi')
    fireEvent.click(send)

    expect(await screen.findByRole('alert')).toHaveTextContent(error)
    expect(text).toHaveValue('hi')
  }
)

it.each([
  [
    'a server error',
    () =>
      runtimeSend.mockResolvedValue({
        success: false,
        status: 500,
        error: 'could not record the feedback',
      }),
  ],
  [
    'a network error',
    () =>
      runtimeSend.mockResolvedValue({
        success: false,
        error: 'Failed to fetch',
      }),
  ],
  [
    'a background that never answered',
    () => runtimeSend.mockRejectedValue(new Error('message port closed')),
  ],
])('shows the fallback for %s and keeps the text', async (_name, arrange) => {
  arrange()
  const { text, send } = await open()
  type(text, 'hi')
  fireEvent.click(send)

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Could not send the feedback. Please try again.'
  )
  expect(text).toHaveValue('hi')
})

it('shows the footer end beside feedback only on the main page', async () => {
  render(
    <SendFeedback footerEnd={<button>Version</button>}>
      <p>Main page</p>
    </SendFeedback>
  )
  const feedback = screen.getByRole('button', { name: 'Send feedback' })
  expect(feedback.parentElement).toContainElement(
    screen.getByRole('button', { name: 'Version' })
  )
  fireEvent.click(feedback)
  await screen.findByRole('textbox', { name: 'Page URL' })
  expect(
    screen.queryByRole('button', { name: 'Version' })
  ).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Back' }))
  expect(screen.getByRole('button', { name: 'Version' })).toBeInTheDocument()
})

it('has no icon on the feedback link', () => {
  render(
    <SendFeedback>
      <p>Main page</p>
    </SendFeedback>
  )
  expect(
    screen.getByRole('button', { name: 'Send feedback' }).querySelector('svg')
  ).toBeNull()
})

it('puts an aria-hidden middle dot between feedback and the footer end, only when one is supplied', () => {
  const { unmount } = render(
    <SendFeedback footerEnd={<button>Version</button>}>
      <p>Main page</p>
    </SendFeedback>
  )
  const dot = screen.getByText('·')
  expect(dot).toHaveAttribute('aria-hidden', 'true')
  expect(dot).toHaveClass('text-muted-foreground/60')
  const feedback = screen.getByRole('button', { name: 'Send feedback' })
  const version = screen.getByRole('button', { name: 'Version' })
  expect(feedback.nextElementSibling).toBe(dot)
  expect(dot.nextElementSibling).toBe(version)
  unmount()

  render(
    <SendFeedback>
      <p>Main page</p>
    </SendFeedback>
  )
  expect(screen.queryByText('·')).not.toBeInTheDocument()
})

it('renders only the feedback button when no footer end is supplied', () => {
  render(
    <SendFeedback>
      <p>Main page</p>
    </SendFeedback>
  )
  expect(screen.getAllByRole('button')).toHaveLength(1)
  expect(
    screen.getByRole('button', { name: 'Send feedback' })
  ).toBeInTheDocument()
})
