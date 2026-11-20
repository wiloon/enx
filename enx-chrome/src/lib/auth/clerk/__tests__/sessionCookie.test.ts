import {
  matchesClerkSessionCookie,
  registerClerkSessionCookieListener,
} from '../sessionCookie'

describe('matchesClerkSessionCookie', () => {
  it('accepts a Clerk session cookie on the sync host', () => {
    expect(
      matchesClerkSessionCookie('https://clerk.localhost.test', {
        removed: false,
        cookie: {
          domain: 'clerk.localhost.test',
          name: '__client_uat',
          value: '1',
        },
      })
    ).toBe(true)
  })

  it('rejects an unrelated cookie', () => {
    expect(
      matchesClerkSessionCookie('https://clerk.localhost.test', {
        removed: false,
        cookie: {
          domain: 'clerk.localhost.test',
          name: 'preferences',
          value: '1',
        },
      })
    ).toBe(false)
  })
})

describe('registerClerkSessionCookieListener', () => {
  it('registers synchronously and forwards only matching changes', () => {
    const addListener = jest.fn()
    const onChange = jest.fn()
    registerClerkSessionCookieListener(
      { onChanged: { addListener } },
      'https://clerk.localhost.test',
      onChange
    )
    expect(addListener).toHaveBeenCalledTimes(1)
    const listener = addListener.mock.calls[0][0]

    listener({
      removed: false,
      cookie: {
        domain: 'other.test',
        name: '__client_uat',
        value: '1',
      },
    })
    expect(onChange).not.toHaveBeenCalled()

    const match = {
      removed: false,
      cookie: {
        domain: 'clerk.localhost.test',
        name: '__client_uat',
        value: '2',
      },
    }
    listener(match)
    expect(onChange).toHaveBeenCalledWith(match)
  })
})
