// First-run onboarding (ADR-047). One step model shared by /welcome and the
// Home checklist (ADR-027): each step is ticked from real state, not from
// which screen the user clicked through, so a user who already did a step
// (signed in, or had Chrome pin the icon) sees it ticked on arrival.

import { SITE } from './site'

export interface OnboardingState {
  installed: boolean
  signedIn: boolean
  isOnToolbar: boolean
  /** The user pressed "Skip" on the pin step. */
  pinSkipped: boolean
  /** The extension marked this tab <html data-enx-learning="on">. */
  learningEnabled: boolean
  /** The user has looked up at least one word, ever. */
  hasLookedUp: boolean
}

export type OnboardingStepId =
  'install' | 'sign-in' | 'pin' | 'enable' | 'look-up'

export type OnboardingStepStatus = 'todo' | 'done' | 'skipped'

export interface OnboardingStep {
  id: OnboardingStepId
  status: OnboardingStepStatus
  title: string
}

export interface OnboardingProgress {
  steps: OnboardingStep[]
  /** The first step still to do; null once every step is done or skipped. */
  current: OnboardingStepId | null
  /** Learning mode is on and a word was looked up (Decision 3). */
  complete: boolean
}

// The only copy of the step titles (ADR-047 Decision 6), as /welcome words
// them; Home overrides some below.
export const ONBOARDING_STEP_TITLES: Record<OnboardingStepId, string> = {
  install: `Add ${SITE.name} to Chrome`,
  'sign-in': 'Sign in',
  pin: `Pin the ${SITE.name} icon`,
  enable: `Turn on ${SITE.name}`,
  'look-up': 'Click any word in the article',
}

// Home has no toolbar step to point at and no article on the page; its
// steps say what happens on /welcome, where the card's button leads.
const HOME_STEP_TITLES: Partial<Record<OnboardingStepId, string>> = {
  enable: `Turn on ${SITE.name} for the article`,
  'look-up': "Click any word you don't know",
}

const stepTitle = (id: OnboardingStepId, view: OnboardingView): string =>
  (view === 'home' ? HOME_STEP_TITLES[id] : undefined) ??
  ONBOARDING_STEP_TITLES[id]

const stepStatus = (done: boolean, skipped = false): OnboardingStepStatus =>
  done ? 'done' : skipped ? 'skipped' : 'todo'

// Decision 3: finished once step 3's two items are ticked. A user who
// ignores the pin step still finishes.
export function onboardingComplete(
  state: Pick<OnboardingState, 'learningEnabled' | 'hasLookedUp'>
): boolean {
  return state.learningEnabled && state.hasLookedUp
}

// Decision 2: /welcome asks the extension for its status only while a step
// still waits on it -- the install, and the pin when that step is showing
// and not skipped.
export function extensionStatusSettled(
  status: { installed: boolean; isOnToolbar: boolean },
  watchToolbar: boolean
): boolean {
  return status.installed && (status.isOnToolbar || !watchToolbar)
}

export type OnboardingView =
  /** /welcome, signed in: every step. */
  | 'full'
  /** /welcome, signed out: every step, with upcoming steps collapsed. */
  | 'signed-out'
  /** Home's checklist (Decision 6): behind sign-in, and the pin is left to
   * /welcome, the only page that asks the extension about it. */
  | 'home'

const VIEW_STEPS: Record<OnboardingView, ReadonlySet<OnboardingStepId>> = {
  full: new Set(['install', 'pin', 'sign-in', 'enable', 'look-up']),
  'signed-out': new Set(['install', 'pin', 'sign-in', 'enable', 'look-up']),
  home: new Set(['install', 'enable', 'look-up']),
}

export function onboardingSteps(
  state: OnboardingState,
  view: OnboardingView = 'full'
): OnboardingProgress {
  const entries: [OnboardingStepId, OnboardingStepStatus][] = [
    ['pin', stepStatus(state.isOnToolbar, state.pinSkipped)],
    ['sign-in', stepStatus(state.signedIn)],
    ['enable', stepStatus(state.learningEnabled)],
    ['look-up', stepStatus(state.hasLookedUp)],
  ]
  // Welcome keeps the completed install; Home only shows it when missing.
  if (view !== 'home' || !state.installed)
    entries.unshift(['install', stepStatus(state.installed)])

  const steps = entries
    .filter(([id]) => VIEW_STEPS[view].has(id))
    .map(([id, s]) => ({
      id,
      status: s,
      title:
        id === 'install' && s === 'done'
          ? `${SITE.name} extension installed`
          : id === 'sign-in' && s !== 'done'
            ? 'Create your free account'
            : stepTitle(id, view),
    }))
  const current = steps.find((step) => step.status === 'todo')?.id ?? null
  return { steps, current, complete: onboardingComplete(state) }
}

// Home shows the checklist only to a signed-in user with no reading yet, so
// everything but the install is still to do.
export function homeChecklistSteps(installed: boolean): OnboardingStep[] {
  return onboardingSteps(
    {
      installed,
      signedIn: true,
      isOnToolbar: false,
      pinSkipped: false,
      learningEnabled: false,
      hasLookedUp: false,
    },
    'home'
  ).steps
}

export type WelcomeLanding =
  /** Still waiting on sign-in state or the user's history. */
  | 'loading'
  /** Signed out: the full setup list, starting with install or sign in. */
  | 'sign-in'
  | 'steps'
  | 'done'
  /** A returning user who arrived from an install: straight to /app. */
  | 'app'

// Decision 1a: a returning user (finished or skipped onboarding before, or
// has looked up a word) never sees the steps. Arriving from an install they
// go to /app; opening /welcome themselves they see the finished page.
export function welcomeLanding(input: {
  signedIn: boolean | undefined
  fromInstall: boolean
  onboardingCompleted: boolean | undefined
  hasLookedUp: boolean | undefined
}): WelcomeLanding {
  if (input.signedIn === undefined) return 'loading'
  if (!input.signedIn) return 'sign-in'
  if (
    input.onboardingCompleted === undefined ||
    input.hasLookedUp === undefined
  )
    return 'loading'
  const returning = input.onboardingCompleted || input.hasLookedUp
  if (!returning) return 'steps'
  return input.fromInstall ? 'app' : 'done'
}
