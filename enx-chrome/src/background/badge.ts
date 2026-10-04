// adr-046: the toolbar badge, per tab. The content script reports learning
// mode's status; this module puts it on the badge, clears it when the tab
// navigates, and decides whether to ask the user to pin the icon.

import { badgeFor, type LearningModeStatus } from '@/lib/learningModeStatus'

// The manifest has no action.default_title, so Chrome's default hover text is
// the extension name; a per-tab title can't be unset, only overwritten.
const defaultTitle = (): string => chrome.runtime.getManifest().name ?? ''

export async function applyStatus(
  tabId: number,
  status: LearningModeStatus
): Promise<void> {
  const { text, color, title } = badgeFor(status)
  await Promise.all([
    chrome.action.setBadgeText({ tabId, text }),
    color
      ? chrome.action.setBadgeBackgroundColor({ tabId, color })
      : Promise.resolve(),
    chrome.action.setTitle({ tabId, title: title ?? defaultTitle() }),
  ])
}

export const resetTab = (tabId: number): Promise<void> =>
  applyStatus(tabId, { status: 'off' })

// --- "Pin Catglish to your toolbar" (Decision 6) ---------------------------
// Pinned or not is this browser's setting, so the count lives in
// storage.local -- never on enx-api.

export const PIN_HINT_STORAGE_KEY = 'enx-pin-hint'
export const PIN_HINT_MAX_SHOWS = 2

interface PinHintState {
  shown: number
  dismissed: boolean
}

const readPinHint = async (): Promise<PinHintState> => {
  const stored = (await chrome.storage.local.get(PIN_HINT_STORAGE_KEY))?.[
    PIN_HINT_STORAGE_KEY
  ] as Partial<PinHintState> | undefined
  return { shown: stored?.shown ?? 0, dismissed: stored?.dismissed ?? false }
}

const writePinHint = (state: PinHintState): Promise<void> =>
  chrome.storage.local.set({ [PIN_HINT_STORAGE_KEY]: state })

// True when the page should show the pin hint; counts the showing. Only
// callable here: getUserSettings is unavailable to content scripts.
export async function maybeAskToPin(): Promise<boolean> {
  const { isOnToolbar } = await chrome.action.getUserSettings()
  if (isOnToolbar) return false
  const state = await readPinHint()
  if (state.dismissed || state.shown >= PIN_HINT_MAX_SHOWS) return false
  await writePinHint({ ...state, shown: state.shown + 1 })
  return true
}

export async function dismissPinHint(): Promise<void> {
  await writePinHint({ ...(await readPinHint()), dismissed: true })
}
