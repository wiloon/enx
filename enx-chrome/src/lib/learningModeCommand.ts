// #230: the keyboard shortcut that turns learning mode on or off on the
// current tab without opening the popup. This is the decision; background.ts
// only hands it chrome.commands.onCommand and the chrome.* wrappers.

import type { EnxRunResponse } from '@/lib/enableLearningMode'
import { failed, type EnableFailureReason } from '@/lib/enableOutcome'
import {
  isLearningModeOn,
  statusForOutcome,
  type LearningModeStatus,
} from '@/lib/learningModeStatus'

/** The manifest's `commands` key; keep the two in step. */
export const TOGGLE_LEARNING_MODE_COMMAND = 'toggle-learning-mode'

/** What the popup shows for the toggle's key. */
export type LearningModeShortcut =
  { bound: true; key: string } | { bound: false }

// Alt+C is only suggested: Chrome leaves the command unbound (an empty
// shortcut) when another extension or Chrome already holds the key, and the
// user can rebind it, so the popup never assumes "Alt+C". `key` is Chrome's
// own string: ⌥C on a Mac, Alt+C elsewhere.
export function learningModeShortcut(
  commands: ReadonlyArray<{ name?: string; shortcut?: string }>
): LearningModeShortcut {
  const key = commands.find(
    command => command.name === TOGGLE_LEARNING_MODE_COMMAND
  )?.shortcut
  return key ? { bound: true, key } : { bound: false }
}

export interface LearningModeCommandDeps {
  getStatus: (tabId: number) => Promise<LearningModeStatus>
  isSignedIn: () => Promise<boolean>
  enable: (tabId: number) => Promise<EnxRunResponse>
  disable: (tabId: number) => Promise<void>
  showOnBadge: (tabId: number, status: LearningModeStatus) => Promise<void>
}

/** What the key did; only the tests read it. */
export type LearningModeCommandResult =
  'enabled' | 'disabled' | 'failed' | 'ignored'

export async function runLearningModeCommand(
  command: string,
  tabId: number | undefined,
  deps: LearningModeCommandDeps
): Promise<LearningModeCommandResult> {
  if (command !== TOGGLE_LEARNING_MODE_COMMAND || tabId === undefined) {
    return 'ignored'
  }

  // A press while the article is still being prepared does nothing: enxStop
  // can't cancel that run, which would then paint and report ready on a page
  // that believes it is off. A failed run ('error') is off, so the key
  // retries, as the popup's button does.
  const status = await deps.getStatus(tabId)
  if (status.status === 'processing') return 'ignored'
  if (isLearningModeOn(status)) {
    await deps.disable(tabId)
    return 'disabled'
  }

  // The popup has no enable button signed out; the badge says why, as on a
  // granted auto-enable site (adr-046 Decision 7).
  if (!(await deps.isSignedIn())) {
    await deps.showOnBadge(tabId, { status: 'error', reason: 'signed-out' })
    return 'failed'
  }

  // With the popup closed there is no error line to show, so a failure goes
  // to the badge, as statusForOutcome would put it after any run: `!` for
  // what the user can act on, empty for a page Catglish can't read. For a
  // failure after the article was found, the content script's runWithStatus
  // has already written this same status; writing it again is harmless, and
  // nothing else reports injection-blocked, a throw or unsupported-page.
  let reason: EnableFailureReason
  try {
    const response = await deps.enable(tabId)
    if (response?.success) return 'enabled'
    reason = response?.reason ?? 'error'
  } catch (error) {
    console.warn(`[ENX] shortcut could not enable tab ${tabId}:`, error)
    reason = 'error'
  }
  await deps.showOnBadge(tabId, statusForOutcome(failed(reason)))
  return 'failed'
}
