import { waitFor } from '@testing-library/react'
import { createPageArticleChoice } from '../articleChoice'
import { DEFAULT_ADAPTER, type SiteAdapter } from '@/lib/siteAdapters'

const LONG =
  'The sailor reads a long story about the sea, the wind and the stars. '.repeat(
    3
  )

function memoryStorage(initial: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = { ...initial }
  return {
    get: async (key: string) => (key in data ? { [key]: data[key] } : {}),
    set: async (items: Record<string, unknown>) => {
      Object.assign(data, items)
    },
    remove: async (key: string) => {
      delete data[key]
    },
  } as unknown as Pick<chrome.storage.StorageArea, 'get' | 'set' | 'remove'>
}

function setup(
  options: {
    sharing?: boolean
    storage?: Record<string, unknown>
    adapter?: SiteAdapter
    send?: jest.Mock
  } = {}
) {
  const send =
    options.send ?? jest.fn(async () => ({ success: true, recorded: true }))
  const controller = createPageArticleChoice({
    document,
    storage: memoryStorage(options.storage),
    available: () => true,
    mode: { isOn: () => false, stop: jest.fn(), enable: jest.fn(async () => {}) },
    share: {
      enabled: async () => options.sharing ?? true,
      adapter: () => options.adapter ?? DEFAULT_ADAPTER,
      send,
    },
  })
  return { controller, send }
}

async function confirmPick(
  controller: ReturnType<typeof createPageArticleChoice>,
  node: Element
) {
  expect(await controller.start()).toEqual({ success: true })
  node.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }))
  node.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true })
  )
  await waitFor(async () =>
    expect(await controller.status()).toMatchObject({ picking: false })
  )
}

const settle = () => new Promise(resolve => setTimeout(resolve, 20))

beforeEach(() => {
  window.history.pushState(
    {},
    '',
    '/story/jane@example.com/part?utm_source=mail#top'
  )
  document.title = 'A private story title'
})

afterEach(() => {
  document.body.innerHTML = ''
  document.querySelectorAll('[data-enx-ui]').forEach(node => node.remove())
  jest.restoreAllMocks()
})

describe('sharing a confirmed article choice (ADR-073)', () => {
  it('sends the cleaned URL, the selector and fresh automatic detection with its platform, no page text or title', async () => {
    document.body.innerHTML = `<meta name="generator" content="Ghost 5.1"><div class="gh-content">${LONG}</div><main id="picked"><p>${LONG}</p></main>`
    const { controller, send } = setup()

    await confirmPick(controller, document.querySelector('#picked')!)

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send).toHaveBeenCalledWith({
      url: 'http://localhost/story/:redacted/part',
      adapter: 'default',
      selector: '[id="picked"]',
      autoSource: 'article',
      autoSelector: '.gh-content',
      autoPlatform: 'ghost',
    })
  })

  it('detects afresh instead of reporting an earlier saved choice, and reports a whole-page result without a selector', async () => {
    document.body.innerHTML = `<div id="old"><p>Short.</p></div><section id="picked"><p>Also short.</p></section>`
    const { controller, send } = setup({
      storage: { 'articleChoice:localhost': '[id="old"]' },
    })
    await controller.ready
    expect(controller.current()).toMatchObject({ source: 'your-choice' })

    await confirmPick(controller, document.querySelector('#picked')!)

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send).toHaveBeenCalledWith({
      url: 'http://localhost/story/:redacted/part',
      adapter: 'default',
      selector: '[id="picked"]',
      autoSource: 'whole-page',
    })
  })

  it("reports 'none' when automatic detection finds no nodes", async () => {
    document.body.innerHTML = `<main id="picked"><p>${LONG}</p></main>`
    const { controller, send } = setup({
      adapter: {
        ...DEFAULT_ADAPTER,
        name: 'aws-docs',
        contentSelector: '#main-col-body',
      },
    })

    await confirmPick(controller, document.querySelector('#picked')!)

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send).toHaveBeenCalledWith({
      url: 'http://localhost/story/:redacted/part',
      adapter: 'aws-docs',
      selector: '[id="picked"]',
      autoSource: 'none',
    })
  })

  it('sends nothing while sharing is off', async () => {
    document.body.innerHTML = `<main id="picked"><p>${LONG}</p></main>`
    const { controller, send } = setup({ sharing: false })

    await confirmPick(controller, document.querySelector('#picked')!)
    await settle()

    expect(controller.current()).toMatchObject({
      source: 'your-choice',
      saved: true,
    })
    expect(send).not.toHaveBeenCalled()
  })

  it('sends nothing for a page-only choice that has no selector', async () => {
    document.body.innerHTML =
      '<div class="css-a1b2c3">A sailor reads this article.</div><div>A fox reads another story.</div>'
    const { controller, send } = setup()

    await confirmPick(controller, document.querySelector('div')!)
    await settle()

    expect(controller.current()).toMatchObject({
      source: 'your-choice',
      saved: false,
    })
    expect(send).not.toHaveBeenCalled()
  })

  it.each([
    ['a refused send', jest.fn(async () => ({ success: false, error: 'x' }))],
    [
      'a network error',
      jest.fn(async () => {
        throw new Error('offline')
      }),
    ],
  ])(
    'drops %s silently: the choice stays applied, nothing is shown and nothing is retried',
    async (_name, send) => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
      document.body.innerHTML = `<main id="picked"><p>${LONG}</p></main>`
      const { controller } = setup({ send })

      await confirmPick(controller, document.querySelector('#picked')!)
      await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
      await settle()

      expect(send).toHaveBeenCalledTimes(1)
      expect(await controller.status()).toMatchObject({
        error: undefined,
        choice: { source: 'your-choice', saved: true },
      })
      expect(
        document.querySelectorAll('[data-enx-ui="article-choice-notice"]')
      ).toHaveLength(1)
      const shadow = document.getElementById('enx-article-choice-notice')
        ?.shadowRoot
      expect(shadow?.querySelector('p')?.textContent).toBe(
        'Your article choice is remembered for this site.'
      )
      expect(shadow?.querySelector('[role="alert"]')).toBeNull()
      expect(warn).toHaveBeenCalledTimes(1)
      const logged = warn.mock.calls[0].join(' ')
      expect(logged).not.toContain('localhost')
      expect(logged).not.toContain('picked')
    }
  )
})
