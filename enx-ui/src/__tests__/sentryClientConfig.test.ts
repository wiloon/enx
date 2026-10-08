const init = jest.fn()

jest.mock('@sentry/nextjs', () => ({
  init: (options: unknown) => init(options),
  replayIntegration: () => ({ name: 'Replay' }),
}))

// Session Replay records visitors' clicks, mouse movement and scrolling. The
// privacy policy does not cover it, and the beta does not use it (WIL-131).
describe('sentry.client.config', () => {
  it('does not record session replays', async () => {
    await import('../../sentry.client.config')

    expect(init).toHaveBeenCalledTimes(1)
    const options = init.mock.calls[0][0]
    expect(options.integrations ?? []).not.toContainEqual({ name: 'Replay' })
    expect(options).not.toHaveProperty('replaysSessionSampleRate')
    expect(options).not.toHaveProperty('replaysOnErrorSampleRate')
  })
})
