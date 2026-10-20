// First-run onboarding (ADR-047). One step model shared by /welcome and the
// Home checklist (ADR-027): each step is ticked from real state, not from
// which screen the user clicked through, so a user who already did a step
// (signed in, or had Chrome pin the icon) sees it ticked on arrival.

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
  complete: boolean
}

// The only copy of the step titles (ADR-047 Decision 6).
export const ONBOARDING_STEP_TITLES: Record<OnboardingStepId, string> = {
  install: 'Add Catglish to Chrome',
  'sign-in': 'Sign in',
  pin: 'Pin the Catglish icon',
  enable: 'Click the Catglish icon in your toolbar, then Read with Catglish',
  'look-up': 'Click any word in the article',
}

const status = (done: boolean, skipped = false): OnboardingStepStatus =>
  done ? 'done' : skipped ? 'skipped' : 'todo'

export function onboardingSteps(state: OnboardingState): OnboardingProgress {
  const entries: [OnboardingStepId, OnboardingStepStatus][] = [
    ['sign-in', status(state.signedIn)],
    ['pin', status(state.isOnToolbar, state.pinSkipped)],
    ['enable', status(state.learningEnabled)],
    ['look-up', status(state.hasLookedUp)],
  ]
  // Step 0 exists only while the extension is missing (Decision 2).
  if (!state.installed) entries.unshift(['install', 'todo'])

  const steps = entries.map(([id, s]) => ({
    id,
    status: s,
    title: ONBOARDING_STEP_TITLES[id],
  }))
  const current = steps.find((step) => step.status === 'todo')?.id ?? null
  return { steps, current, complete: current === null }
}

export type WelcomeLanding =
  /** Still waiting on sign-in state or the user's history. */
  | 'loading'
  /** Signed out: install (when missing) and sign in, nothing more. */
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
