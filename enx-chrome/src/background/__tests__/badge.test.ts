import {
  applyStatus,
  dismissPinHint,
  maybeAskToPin,
  PIN_HINT_STORAGE_KEY,
  resetTab,
} from '../badge'
import { BADGE_BRAND_COLOR } from '@/lib/learningModeStatus'

// An in-memory chrome.storage.local, so the pin-hint count persists across
// calls the way it does in the browser.
let store: Record<string, unknown>

beforeEach(() => {
  jest.resetAllMocks()
  store = {}
  ;(chrome.storage.local.get as jest.Mock).mockImplementation(
    async (key: string) => (key in store ? { [key]: store[key] } : {})
  )
  ;(chrome.storage.local.set as jest.Mock).mockImplementation(
    async (items: Record<string, unknown>) => Object.assign(store, items)
  )
  ;(chrome.runtime.getManifest as jest.Mock).mockReturnValue({
    name: 'Catglish',
  })
  ;(chrome.action.setBadgeText as jest.Mock).mockResolvedValue(undefined)
  ;(chrome.action.setBadgeBackgroundColor as jest.Mock).mockResolvedValue(
    undefined
  )
  ;(chrome.action.setTitle as jest.Mock).mockResolvedValue(undefined)
})

describe('applyStatus', () => {
  it('sets the badge, colour and title for that tab only', async () => {
    await applyStatus(7, { status: 'ready' })
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({
      tabId: 7,
      text: '✓',
    })
    expect(chrome.action.setBadgeBackgroundColor).toHaveBeenCalledWith({
      tabId: 7,
      color: BADGE_BRAND_COLOR,
    })
    expect(chrome.action.setTitle).toHaveBeenCalledWith({
      tabId: 7,
      title: expect.stringContaining('Catglish is on'),
    })
  })

  it('resetTab clears the badge and restores the default title', async () => {
    await resetTab(7)
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({
      tabId: 7,
      text: '',
    })
    expect(chrome.action.setBadgeBackgroundColor).not.toHaveBeenCalled()
    expect(chrome.action.setTitle).toHaveBeenCalledWith({
      tabId: 7,
      title: 'Catglish',
    })
  })
})

describe('maybeAskToPin (adr-046 Decision 6)', () => {
  const pinned = (isOnToolbar: boolean) =>
    (chrome.action.getUserSettings as jest.Mock).mockResolvedValue({
      isOnToolbar,
    })

  it('never asks when the icon is pinned', async () => {
    pinned(true)
    expect(await maybeAskToPin()).toBe(false)
    expect(store[PIN_HINT_STORAGE_KEY]).toBeUndefined()
  })

  it('asks the first two times while unpinned, not the third', async () => {
    pinned(false)
    expect(await maybeAskToPin()).toBe(true)
    expect(await maybeAskToPin()).toBe(true)
    expect(await maybeAskToPin()).toBe(false)
  })

  it('stops asking after "Don\'t show again"', async () => {
    pinned(false)
    await dismissPinHint()
    expect(await maybeAskToPin()).toBe(false)
  })
})
