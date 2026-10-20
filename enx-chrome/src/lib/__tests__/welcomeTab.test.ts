import { welcomeTabAction, welcomeUrlPattern } from '../welcomeTab'

const UI = 'https://catglish.com'

describe('welcomeTabAction (ADR-047 Decision 1)', () => {
  it('opens /welcome?src=install on a fresh install with no /welcome tab', () => {
    expect(welcomeTabAction('install', UI, [])).toEqual({
      kind: 'open',
      url: 'https://catglish.com/welcome?src=install',
    })
  })

  it('switches back to an open /welcome tab instead of opening another', () => {
    const tabs = [{ id: 4, windowId: 2, url: 'https://catglish.com/welcome' }]
    expect(welcomeTabAction('install', UI, tabs)).toEqual({
      kind: 'focus',
      tabId: 4,
      windowId: 2,
    })
  })

  it('ignores tabs that are not /welcome on the enx-ui origin', () => {
    const tabs = [
      { id: 1, windowId: 1, url: 'https://catglish.com/welcomes' },
      { id: 2, windowId: 1, url: 'https://evil.example/welcome' },
      { id: 3, windowId: 1, url: 'https://catglish.com/app' },
    ]
    expect(welcomeTabAction('install', UI, tabs).kind).toBe('open')
  })

  it('matches /welcome with a query string', () => {
    const tabs = [
      { id: 9, windowId: 3, url: 'https://catglish.com/welcome?src=x' },
    ]
    expect(welcomeTabAction('install', UI, tabs)).toEqual({
      kind: 'focus',
      tabId: 9,
      windowId: 3,
    })
  })

  it('treats a base URL with a trailing slash as the same origin', () => {
    const tabs = [{ id: 4, windowId: 2, url: 'https://catglish.com/welcome' }]
    expect(welcomeTabAction('install', `${UI}/`, tabs).kind).toBe('focus')
    expect(welcomeTabAction('install', `${UI}/`, [])).toEqual({
      kind: 'open',
      url: 'https://catglish.com/welcome?src=install',
    })
    expect(welcomeUrlPattern(`${UI}/`)).toBe('https://catglish.com/welcome*')
  })

  it('does nothing on update', () => {
    expect(welcomeTabAction('update', UI, [])).toEqual({ kind: 'none' })
  })
})
