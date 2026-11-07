import {
  ACCOUNT_CHANGED_MESSAGE,
  createPanelAccountFence,
  freshAtDelivery,
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

// #686
const UNVERIFIED = {
  success: false,
  error: "We couldn't verify your sign-in. Try again, or sign in again.",
  sessionUnverified: true,
  accountGeneration: 3,
}
const SUPERSEDED_UNVERIFIED = {
  ...UNVERIFIED,
  error: ACCOUNT_CHANGED_MESSAGE,
  sessionExpired: false,
  sessionUnverified: false,
}

describe('createPanelAccountFence and an unverified response', () => {
  it('keeps it when nothing changed while it was outstanding', () => {
    const fence = createPanelAccountFence()
    const current = fence.capture()
    expect(current(UNVERIFIED)).toEqual(UNVERIFIED)
  })

  it('makes it an ordinary failure once a signed-in account took over', () => {
    const fence = createPanelAccountFence()
    const current = fence.capture()
    fence.record('switched')
    expect(current(UNVERIFIED)).toEqual(SUPERSEDED_UNVERIFIED)
  })
})

describe('freshAtDelivery', () => {
  it('keeps an unverified response the worker classified for its current account', () => {
    expect(
      freshAtDelivery(UNVERIFIED, { sessionLost: false, accountGeneration: 3 })
    ).toEqual(UNVERIFIED)
  })

  it('supersedes an unverified response once the worker switched accounts', () => {
    expect(
      freshAtDelivery(UNVERIFIED, { sessionLost: false, accountGeneration: 4 })
    ).toEqual(SUPERSEDED_UNVERIFIED)
  })

  it('keeps an unverified response when the worker has since lost the session', () => {
    expect(
      freshAtDelivery(UNVERIFIED, { sessionLost: true, accountGeneration: 4 })
    ).toEqual(UNVERIFIED)
  })

  it('keeps an unverified response when the worker could not be asked', () => {
    expect(freshAtDelivery(UNVERIFIED, undefined)).toEqual(UNVERIFIED)
  })

  it('supersedes a signed-out response once the worker holds a session again', () => {
    expect(
      freshAtDelivery(SIGNED_OUT, { sessionLost: false, accountGeneration: 9 })
    ).toEqual({
      ...SIGNED_OUT,
      error: ACCOUNT_CHANGED_MESSAGE,
      sessionExpired: false,
    })
  })

  it('keeps a signed-out response while the session stays lost', () => {
    expect(
      freshAtDelivery(SIGNED_OUT, { sessionLost: true, accountGeneration: 9 })
    ).toEqual(SIGNED_OUT)
  })
})
