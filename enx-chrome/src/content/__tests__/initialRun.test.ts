import {
  createInitialRunner,
  INITIAL_READY_TIMEOUT_MS,
} from '@/content/initialRun'
import { createSpaRebuilder } from '@/content/spaRebuild'
import { ENABLE_OK, type EnableOutcome } from '@/lib/enableOutcome'
import {
  lookupAreaOptions,
  resolveSiteAdapter,
  type SiteAdapter,
  type SiteOrigins,
} from '@/lib/siteAdapters'
import { WordProcessor, type LookupArea } from '@/lib/wordProcessor'

const SITES: SiteOrigins = { uiOrigins: [], rssxOrigins: [] }
const adapterAt = (url: string) => resolveSiteAdapter(new URL(url), SITES)
const AWS_DOCS = adapterAt(
  'https://docs.aws.amazon.com/lambda/latest/dg/welcome.html'
)
const WIKIPEDIA = adapterAt('https://en.wikipedia.org/wiki/Lantern')
const X = adapterAt('https://x.com/jack/status/20')

const COLUMN_TEXT =
  'AWS Lambda is a serverless compute service. With Lambda, you can run code without provisioning or managing servers.'

// Article detection as processArticleContent runs it, recording what it found.
const detection = (adapter: SiteAdapter) => {
  const found: LookupArea[] = []
  const process = jest.fn(async (): Promise<EnableOutcome> => {
    found.push(WordProcessor.findLookupArea(lookupAreaOptions(adapter)))
    return ENABLE_OK
  })
  return { found, process }
}

const track = <T>(promise: Promise<T>) => {
  const state: { done: boolean; value?: T } = { done: false }
  promise.then(value => {
    state.done = true
    state.value = value
  })
  return state
}

// Lets MutationObserver callbacks and promise continuations run.
const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

const insertColumn = () => {
  const column = document.createElement('div')
  column.id = 'main-col-body'
  document.getElementById('main-col')!.appendChild(column)
  return column
}

describe('initial run', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    document.body.innerHTML =
      '<header><p>AWS Documentation navigation and search, shown on every docs page of the site.</p></header><div id="main-col"></div>'
  })
  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('a static adapter waits for its column to fill and go quiet, then detects it', async () => {
    const { found, process } = detection(AWS_DOCS)
    const run = track(
      createInitialRunner().run({
        adapter: AWS_DOCS,
        isCurrent: () => true,
        process,
      })
    )
    await settle()
    expect(process).not.toHaveBeenCalled()

    const column = insertColumn()
    await settle()
    jest.advanceTimersByTime(50)
    column.innerHTML = `<p>${COLUMN_TEXT}</p>`
    await settle()
    jest.advanceTimersByTime(90)
    await settle()
    expect(process).not.toHaveBeenCalled()

    jest.advanceTimersByTime(20)
    await settle()
    expect(run).toEqual({ done: true, value: ENABLE_OK })
    expect(found).toEqual([
      { nodes: [column], source: 'article', selector: '#main-col-body' },
    ])
  })

  it('a static adapter whose selector never appears waits out the timeout, then gets the whole page', async () => {
    const { found, process } = detection(AWS_DOCS)
    createInitialRunner().run({
      adapter: AWS_DOCS,
      isCurrent: () => true,
      process,
    })
    jest.advanceTimersByTime(INITIAL_READY_TIMEOUT_MS - 1)
    await settle()
    expect(process).not.toHaveBeenCalled()

    jest.advanceTimersByTime(1)
    await settle()
    expect(found).toEqual([{ nodes: [document.body], source: 'whole-page' }])
  })

  it('an adapter without a readySelector detects at once', async () => {
    const { process } = detection(WIKIPEDIA)
    createInitialRunner().run({
      adapter: WIKIPEDIA,
      isCurrent: () => true,
      process,
    })
    await settle()
    expect(process).toHaveBeenCalledTimes(1)
    expect(jest.getTimerCount()).toBe(0)
  })

  describe('a pending wait on a quiet page, cancelled', () => {
    const expectCancelledPromptly = async (
      run: { done: boolean; value?: EnableOutcome },
      process: jest.Mock,
      disconnect: jest.SpyInstance
    ) => {
      await settle()
      expect(run).toEqual({ done: true, value: ENABLE_OK })
      expect(disconnect).toHaveBeenCalled()
      expect(jest.getTimerCount()).toBe(0)
      jest.advanceTimersByTime(INITIAL_READY_TIMEOUT_MS)
      await settle()
      expect(process).not.toHaveBeenCalled()
    }

    it('by a superseding run', async () => {
      const disconnect = jest.spyOn(MutationObserver.prototype, 'disconnect')
      const runner = createInitialRunner()
      const first = detection(AWS_DOCS)
      const run = track(
        runner.run({
          adapter: AWS_DOCS,
          isCurrent: () => true,
          process: first.process,
        })
      )
      await settle()

      const second = detection(WIKIPEDIA)
      runner.run({
        adapter: WIKIPEDIA,
        isCurrent: () => true,
        process: second.process,
      })

      await expectCancelledPromptly(run, first.process, disconnect)
      expect(second.process).toHaveBeenCalledTimes(1)
    })

    it('by turning learning mode off', async () => {
      const disconnect = jest.spyOn(MutationObserver.prototype, 'disconnect')
      const runner = createInitialRunner()
      let lifecycle = 0
      const mine = lifecycle
      const { process } = detection(AWS_DOCS)
      const run = track(
        runner.run({
          adapter: AWS_DOCS,
          isCurrent: () => mine === lifecycle,
          process,
        })
      )
      await settle()

      lifecycle++
      runner.cancel()

      await expectCancelledPromptly(run, process, disconnect)
    })

    it('by the script standing down', async () => {
      const disconnect = jest.spyOn(MutationObserver.prototype, 'disconnect')
      const runner = createInitialRunner()
      let stoodDown = false
      const { process } = detection(AWS_DOCS)
      const run = track(
        runner.run({
          adapter: AWS_DOCS,
          isCurrent: () => !stoodDown,
          process,
        })
      )
      await settle()

      stoodDown = true
      runner.cancel()

      await expectCancelledPromptly(run, process, disconnect)
    })

    it('by an SPA navigation', async () => {
      const disconnect = jest.spyOn(MutationObserver.prototype, 'disconnect')
      const runner = createInitialRunner()
      const rebuilder = createSpaRebuilder({
        isPageSupported: () => false,
        waitForContentReady: async () => {},
        teardown: runner.cancel,
        rebuild: async () => {},
      })
      const { process } = detection(X)
      const run = track(
        runner.run({
          adapter: X,
          isCurrent: rebuilder.makeIsCurrent(),
          process,
        })
      )
      await settle()

      await rebuilder.onRouteChange('https://x.com/jack')

      await expectCancelledPromptly(run, process, disconnect)
    })
  })
})
