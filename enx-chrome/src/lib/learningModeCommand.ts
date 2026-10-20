// #230: the keyboard shortcut that turns learning mode on or off on the
// current tab without opening the popup. This is the decision; background.ts
// only hands it chrome.commands.onCommand and the chrome.* wrappers.

import type { EnxRunResponse } from '@/lib/enableLearningMode'
import { failed, type EnableFailureReason } from '@/lib/enableOutcome'
import {
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
  enable: (tabId: number) => Promise<EnxRunResponse>
  disable: (tabId: number) => Promise<void>
  /** Puts a status on the tab's badge (adr-046). */
  report: (tabId: number, status: LearningModeStatus) => Promise<void>
}

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

  // 'processing' counts as on: pressing the key again means "stop". A failed
  // run ('error') is off, so the key retries, as the popup's button does.
  const { status } = await deps.getStatus(tabId)
  if (status === 'ready' || status === 'processing') {
    await deps.disable(tabId)
    return 'disabled'
  }

  // With the popup closed there is no error line to show, so a failure goes
  // to the badge, as statusForOutcome would put it after any run: `!` for
  // what the user can act on, empty for a page Catglish can't read.
  let reason: EnableFailureReason
  try {
    const response = await deps.enable(tabId)
    if (response?.success) return 'enabled'
    reason = (response?.reason as EnableFailureReason | undefined) ?? 'error'
  } catch (error) {
    console.warn(`[ENX] shortcut could not enable tab ${tabId}:`, error)
    reason = 'error'
  }
  await deps.report(tabId, statusForOutcome(failed(reason)))
  return 'failed'
}
