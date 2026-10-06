// adr-046: the content script reports learning mode's status for the toolbar
// badge and no longer writes a status notice into the article. These tests
// load the real content script against a jsdom page and a fake background.

jest.mock('@/config/env')

type Message = { type?: string; action?: string; status?: unknown }
type Responder = (message: Message) => unknown

const ARTICLE_TEXT =
  'The quick brown fox jumps over the lazy dog while the patient reader ' +
  'keeps reading this paragraph about foxes, dogs and other animals.'

let sent: Message[]
let respond: Responder

const statuses = () =>
  sent.filter(m => m.type === 'learningModeStatus').map(m => m.status)

const defaultRespond: Responder = message => {
  switch (message.type) {
    case 'getWords':
      return {
        success: true,
        wordProperties: {
          fox: {
            Key: 'fox',
            English: 'fox',
            Chinese: '狐狸',
            Pronunciation: '',
            LoadCount: 1,
            AlreadyAcquainted: 0,
            WordType: 0,
          },
        },
      }
    case 'shouldAutoEnable':
      return { success: true, autoEnable: false }
    default:
      return { success: true }
  }
}

// Loads content.tsx fresh and returns its runtime.onMessage listener.
const loadContentScript = async () => {
  await jest.isolateModulesAsync(async () => {
    await import('../content')
  })
  const calls = (chrome.runtime.onMessage.addListener as jest.Mock).mock.calls
  const listener = calls[calls.length - 1][0] as (
    request: unknown,
    sender: unknown,
    sendResponse: (r: unknown) => void
  ) => unknown
  return (request: unknown) =>
    new Promise<Record<string, unknown>>(resolve => {
      listener(request, {}, resolve as (r: unknown) => void)
    })
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

// jsdom has no Popover API.
const popoverProto = HTMLElement.prototype as HTMLElement & {
  showPopover?: () => void
  hidePopover?: () => void
}
popoverProto.showPopover ??= () => {}
popoverProto.hidePopover ??= () => {}

beforeAll(() => {
  // The content script narrates every step; keep the test output readable.
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'debug').mockImplementation(() => {})
})

beforeEach(() => {
  sent = []
  respond = defaultRespond
  ;(chrome.runtime.sendMessage as jest.Mock).mockImplementation(
    (message: Message, callback?: (r: unknown) => void) => {
      sent.push(message)
      callback?.(respond(message))
    }
  )
  ;(chrome.runtime.getManifest as jest.Mock).mockReturnValue({
    version: '0.0.0-test',
  })
  ;(chrome.storage.local.get as jest.Mock).mockResolvedValue({})
  ;(chrome.storage.local.set as jest.Mock).mockResolvedValue(undefined)
  document.head.innerHTML = ''
})

describe('content script learning-mode status (adr-046)', () => {
  it('reports processing then ready on a page with an article', async () => {
    document.body.innerHTML = `<article><p>${ARTICLE_TEXT}</p></article>`
    const send = await loadContentScript()

    expect(await send({ action: 'enxRun' })).toMatchObject({ success: true })
    expect(statuses()).toEqual([{ status: 'processing' }, { status: 'ready' }])
  })

  it('no longer inserts a status notice into the article', async () => {
    document.body.innerHTML = `<article><p>${ARTICLE_TEXT}</p></article>`
    const send = await loadContentScript()

    await send({ action: 'enxRun' })
    expect(document.getElementById('enx-processing-complete')).toBeNull()
    expect(document.querySelector('article')!.children).toHaveLength(1)
  })

  it('never reports processing on a page with no article', async () => {
    document.body.innerHTML = '<nav>Home</nav>'
    const send = await loadContentScript()

    expect(await send({ action: 'enxRun' })).toMatchObject({
      success: false,
      reason: 'no-article-node',
    })
    expect(statuses()).toEqual([{ status: 'off' }])
  })

  it('reports an error when the session has expired', async () => {
    document.body.innerHTML = `<article><p>${ARTICLE_TEXT}</p></article>`
    respond = message =>
      message.type === 'getWords'
        ? { success: false, sessionExpired: true }
        : defaultRespond(message)
    const send = await loadContentScript()

    await send({ action: 'enxRun' })
    expect(statuses()).toEqual([
      { status: 'processing' },
      { status: 'error', reason: 'session-expired' },
    ])
  })

  it('reports off when learning mode is turned off', async () => {
    document.body.innerHTML = `<article><p>${ARTICLE_TEXT}</p></article>`
    const send = await loadContentScript()
    await send({ action: 'enxRun' })
    sent = []

    await send({ action: 'enxStop' })
    expect(statuses()).toEqual([{ status: 'off' }])
  })

  it('shows the pin hint in the top layer when the background asks', async () => {
    document.body.innerHTML = `<article><p>${ARTICLE_TEXT}</p></article>`
    respond = message =>
      message.type === 'learningModeStatus'
        ? { success: true, showPinHint: true }
        : defaultRespond(message)
    const send = await loadContentScript()

    await send({ action: 'enxRun' })
    await flush()
    const hint = document.querySelector('.enx-pin-hint')
    expect(hint).not.toBeNull()
    expect(hint!.parentElement).toBe(document.body)
    expect(document.querySelector('article .enx-pin-hint')).toBeNull()
  })
})
