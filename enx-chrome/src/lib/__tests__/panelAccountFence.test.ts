import {
  ACCOUNT_CHANGED_MESSAGE,
  createPanelAccountFence,
} from '../panelAccountFence'

const SIGNED_OUT = {
  success: false,
  error: 'Your session has expired. Please login again.',
  sessionExpired: true,
}

describe('createPanelAccountFence', () => {
  it('keeps a signed-out response when the session was lost after it started', () => {
    const fence = createPanelAccountFence()
    const current = fence.capture()
    fence.record('lost')
    expect(current(SIGNED_OUT)).toEqual(SIGNED_OUT)
  })

  it('makes a signed-out response an ordinary failure once a signed-in account took over', () => {
    const fence = createPanelAccountFence()
    const current = fence.capture()
    fence.record('expired')
    fence.record('switched')
    expect(current(SIGNED_OUT)).toEqual({
      success: false,
      error: ACCOUNT_CHANGED_MESSAGE,
      sessionExpired: false,
    })
  })

  it('keeps a signed-out response when the new account lost its session too', () => {
    const fence = createPanelAccountFence()
    const current = fence.capture()
    fence.record('switched')
    fence.record('expired')
    expect(current(SIGNED_OUT)).toEqual(SIGNED_OUT)
  })

  it('leaves a request started after the switch alone', () => {
    const fence = createPanelAccountFence()
    fence.record('switched')
    const current = fence.capture()
    expect(current(SIGNED_OUT)).toEqual(SIGNED_OUT)
  })
})
