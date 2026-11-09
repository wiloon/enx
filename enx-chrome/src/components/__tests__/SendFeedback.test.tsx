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
  render(<SendFeedback />)
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

it('keeps a cleared URL when the panel is collapsed and reopened', async () => {
  const { url } = await open()
  await waitFor(() => expect(url).not.toHaveValue(''))
  type(url, '')
  const toggle = screen.getByRole('button', { name: 'Send feedback' })
  fireEvent.click(toggle)
  fireEvent.click(toggle)
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
  expect(await screen.findByRole('button', { name: 'Send' })).toBeDisabled()
  expect(sentFeedback()).toHaveLength(1)
})

it('thanks the user and resets the text and the URL after a successful send', async () => {
  const { text, url, send } = await open()
  await waitFor(() => expect(url).not.toHaveValue(''))
  type(url, 'https://example.com/other')
  type(text, 'hi')
  fireEvent.click(send)

  expect(await screen.findByRole('status')).toHaveTextContent(
    'Thanks — feedback sent'
  )
  expect(text).toHaveValue('')
  expect(url).toHaveValue('https://example.com/news/:redacted/story')
})

it.each([
  [400, 'invalid feedback: url "foo" is not a web page'],
  [429, 'Daily feedback limit reached. Please try again tomorrow.'],
])("shows the API's message for a %i and keeps the text", async (status, error) => {
  runtimeSend.mockResolvedValue({ success: false, status, error })
  const { text, send } = await open()
  type(text, 'hi')
  fireEvent.click(send)

  expect(await screen.findByRole('alert')).toHaveTextContent(error)
  expect(text).toHaveValue('hi')
})

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
