import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ArticleChoiceControl from '../ArticleChoiceControl'

beforeEach(() => {
  ;(chrome.tabs.query as jest.Mock).mockResolvedValue([
    { id: 7, url: 'https://example.com/story' },
  ])
  ;(chrome.tabs.sendMessage as jest.Mock).mockResolvedValue({
    success: true,
    available: true,
    choice: { source: 'your-choice', saved: false, missed: false },
  })
})

it('explains a page-only choice and lets the user return to automatic detection', async () => {
  render(<ArticleChoiceControl onModeChange={() => {}} />)
  expect(
    await screen.findByText('Your choice · This page only')
  ).toBeInTheDocument()
  expect(screen.getByText(/cannot be remembered/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Use automatic' }))
  await waitFor(() =>
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      7,
      { action: 'useAutomaticArticle' },
      { frameId: 0 }
    )
  )
})

function storedSharing(initial?: boolean) {
  const data: Record<string, unknown> =
    initial === undefined ? {} : { 'enx-article-choice-sharing': initial }
  ;(chrome.storage.local.get as jest.Mock).mockImplementation(
    async (key: string) => (key in data ? { [key]: data[key] } : {})
  )
  ;(chrome.storage.local.set as jest.Mock).mockImplementation(
    async (items: Record<string, unknown>) => {
      Object.assign(data, items)
    }
  )
  return data
}

const chooseArticleSent = () =>
  (chrome.tabs.sendMessage as jest.Mock).mock.calls.some(
    ([, request]) => request.action === 'chooseArticle'
  )

describe('asking before the first pick whether to share article choices', () => {
  let close: jest.SpyInstance
  beforeEach(() => {
    ;(chrome.tabs.sendMessage as jest.Mock).mockClear()
    close = jest.spyOn(window, 'close').mockImplementation(() => {})
  })
  afterEach(() => close.mockRestore())

  it.each([
    ['Share', true],
    ["Don't share", false],
  ])(
    'asks first, then saves "%s" before starting the picker',
    async (button, answer) => {
      const stored = storedSharing()
      ;(chrome.tabs.sendMessage as jest.Mock).mockImplementation(
        async (_tab, request) => {
          if (request.action === 'chooseArticle')
            expect(stored['enx-article-choice-sharing']).toBe(answer)
          return {
            success: true,
            available: true,
            choice: { source: 'automatic', saved: false, missed: false },
          }
        }
      )
      render(<ArticleChoiceControl onModeChange={() => {}} />)
      fireEvent.click(
        await screen.findByRole('button', { name: 'Choose article' })
      )

      const prompt = await screen.findByRole('region', {
        name: 'Share article choices?',
      })
      expect(prompt).toHaveTextContent(/cleaned page address/)
      expect(prompt).toHaveTextContent(/linked to your account/)
      expect(chooseArticleSent()).toBe(false)

      fireEvent.click(screen.getByRole('button', { name: button }))

      await waitFor(() => expect(chooseArticleSent()).toBe(true))
      expect(stored).toEqual({ 'enx-article-choice-sharing': answer })
      expect(close).toHaveBeenCalledTimes(1)
    }
  )

  it('asks again on the next attempt when the popup closed without an answer', async () => {
    const stored = storedSharing()
    const first = render(<ArticleChoiceControl onModeChange={() => {}} />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Choose article' })
    )
    await screen.findByRole('region', { name: 'Share article choices?' })
    first.unmount()

    render(<ArticleChoiceControl onModeChange={() => {}} />)
    expect(
      screen.queryByRole('region', { name: 'Share article choices?' })
    ).toBeNull()
    fireEvent.click(
      await screen.findByRole('button', { name: 'Choose article' })
    )

    expect(
      await screen.findByRole('region', { name: 'Share article choices?' })
    ).toBeInTheDocument()
    expect(stored).toEqual({})
    expect(chooseArticleSent()).toBe(false)
  })

  it.each([true, false])(
    'does not ask again once answered (%s)',
    async answer => {
      storedSharing(answer)
      render(<ArticleChoiceControl onModeChange={() => {}} />)
      fireEvent.click(
        await screen.findByRole('button', { name: 'Choose article' })
      )

      await waitFor(() => expect(chooseArticleSent()).toBe(true))
      expect(
        screen.queryByRole('region', { name: 'Share article choices?' })
      ).toBeNull()
    }
  )
})

it('starts picking while learning mode is off and closes the popup after the picker starts', async () => {
  storedSharing(false)
  const close = jest.spyOn(window, 'close').mockImplementation(() => {})
  try {
    render(<ArticleChoiceControl onModeChange={() => {}} />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Choose article' })
    )
    await waitFor(() =>
      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
        7,
        { action: 'chooseArticle' },
        { frameId: 0 }
      )
    )
    expect(close).toHaveBeenCalledTimes(1)
  } finally {
    close.mockRestore()
  }
})

it('explains a failed saved match and offers Use automatic even during fallback', async () => {
  ;(chrome.tabs.sendMessage as jest.Mock).mockResolvedValue({
    success: true,
    available: true,
    choice: { source: 'automatic', saved: true, missed: true },
  })
  render(<ArticleChoiceControl onModeChange={() => {}} />)
  expect(await screen.findByText(/could not be applied/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Use automatic' })).toBeEnabled()
})

it('does not offer picking on excluded adapter pages', async () => {
  ;(chrome.tabs.sendMessage as jest.Mock).mockResolvedValue({
    success: true,
    available: false,
  })
  const { container } = render(<ArticleChoiceControl onModeChange={() => {}} />)
  await waitFor(() => expect(chrome.tabs.sendMessage).toHaveBeenCalled())
  expect(container).toBeEmptyDOMElement()
})

it('refreshes the source and mode even when automatic detection cannot re-enable', async () => {
  let automatic = false
  const onModeChange = jest.fn()
  ;(chrome.tabs.sendMessage as jest.Mock).mockImplementation(
    async (_tab, request) => {
      if (request.action === 'useAutomaticArticle') {
        automatic = true
        return { success: false, error: 'No words found on this page.' }
      }
      return {
        success: true,
        available: true,
        choice: {
          source: automatic ? 'automatic' : 'your-choice',
          saved: !automatic,
          missed: false,
        },
      }
    }
  )
  render(<ArticleChoiceControl onModeChange={onModeChange} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Use automatic' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'No words found on this page.'
  )
  expect(await screen.findByText('Automatic detection')).toBeInTheDocument()
  await waitFor(() => expect(onModeChange).toHaveBeenCalledTimes(1))
})
