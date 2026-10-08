const init = jest.fn()

jest.mock('@sentry/react', () => ({
  init: (options: unknown) => init(options),
  browserTracingIntegration: () => ({ name: 'BrowserTracing' }),
  replayIntegration: () => ({ name: 'Replay' }),
}))

jest.mock('@/config/env', () => ({ config: { environment: 'test' } }))

import { initSentry } from '../sentry'

// Session Replay records clicks, mouse movement and scrolling -- "User
// activity" on the Web Store's data-usage form, and not in the privacy policy.
describe('initSentry', () => {
  beforeEach(() => {
    init.mockClear()
    process.env.VITE_SENTRY_DSN = 'https://key@sentry.example/1'
  })

  afterAll(() => {
    delete process.env.VITE_SENTRY_DSN
  })

  it('does not record session replays', () => {
    initSentry()

    expect(init).toHaveBeenCalledTimes(1)
    const options = init.mock.calls[0][0]
    expect(
      options.integrations.map((i: { name: string }) => i.name)
    ).not.toContain('Replay')
    expect(options).not.toHaveProperty('replaysSessionSampleRate')
    expect(options).not.toHaveProperty('replaysOnErrorSampleRate')
  })

  it('stays off without a DSN', () => {
    delete process.env.VITE_SENTRY_DSN
    initSentry()
    expect(init).not.toHaveBeenCalled()
  })
})
