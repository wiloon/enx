import {
  onboardingSteps,
  welcomeLanding,
  type OnboardingState,
} from '../onboarding'

describe('welcomeLanding (ADR-047 Decision 1a)', () => {
  const newUser = {
    signedIn: true,
    fromInstall: true,
    onboardingCompleted: false,
    hasLookedUp: false,
  }

  it('shows only sign-in to a signed-out visitor', () => {
    expect(welcomeLanding({ ...newUser, signedIn: false })).toBe('sign-in')
  })

  it('walks a new signed-in user through the steps', () => {
    expect(welcomeLanding(newUser)).toBe('steps')
  })

  it('sends a returning user who just installed to /app', () => {
    expect(welcomeLanding({ ...newUser, onboardingCompleted: true })).toBe(
      'app'
    )
    expect(welcomeLanding({ ...newUser, hasLookedUp: true })).toBe('app')
  })

  it('shows the finished page to a returning user who opened /welcome', () => {
    expect(
      welcomeLanding({ ...newUser, fromInstall: false, hasLookedUp: true })
    ).toBe('done')
  })

  it('waits while sign-in state or history is unknown', () => {
    expect(welcomeLanding({ ...newUser, signedIn: undefined })).toBe('loading')
    expect(welcomeLanding({ ...newUser, hasLookedUp: undefined })).toBe(
      'loading'
    )
  })
})

const fresh: OnboardingState = {
  installed: false,
  signedIn: false,
  isOnToolbar: false,
  pinSkipped: false,
  learningEnabled: false,
  hasLookedUp: false,
}

const statuses = (state: OnboardingState) =>
  Object.fromEntries(
    onboardingSteps(state).steps.map((step) => [step.id, step.status])
  )

describe('onboardingSteps (ADR-047 Decision 2)', () => {
  it('starts with installing when the extension is missing', () => {
    const progress = onboardingSteps(fresh)
    expect(progress.steps.map((s) => s.id)).toEqual([
      'install',
      'sign-in',
      'pin',
      'enable',
      'look-up',
    ])
    expect(progress.current).toBe('install')
    expect(progress.complete).toBe(false)
  })

  it('drops the install step once the extension is there', () => {
    const progress = onboardingSteps({ ...fresh, installed: true })
    expect(progress.steps.map((s) => s.id)).not.toContain('install')
    expect(progress.current).toBe('sign-in')
  })

  it('ticks steps from real state, in any order', () => {
    // Pinned before signing in (or pinned by Chrome itself).
    expect(statuses({ ...fresh, installed: true, isOnToolbar: true })).toEqual({
      'sign-in': 'todo',
      pin: 'done',
      enable: 'todo',
      'look-up': 'todo',
    })
    expect(
      onboardingSteps({ ...fresh, installed: true, isOnToolbar: true }).current
    ).toBe('sign-in')
  })

  it('moves past a skipped pin step without ticking it', () => {
    const state = {
      ...fresh,
      installed: true,
      signedIn: true,
      pinSkipped: true,
    }
    expect(statuses(state).pin).toBe('skipped')
    expect(onboardingSteps(state).current).toBe('enable')
  })

  it('asks for a word click once learning mode is on', () => {
    const state = {
      ...fresh,
      installed: true,
      signedIn: true,
      isOnToolbar: true,
      learningEnabled: true,
    }
    expect(onboardingSteps(state).current).toBe('look-up')
  })

  it('is complete when learning mode is on and a word was looked up', () => {
    const progress = onboardingSteps({
      ...fresh,
      installed: true,
      signedIn: true,
      pinSkipped: true,
      learningEnabled: true,
      hasLookedUp: true,
    })
    expect(progress.complete).toBe(true)
    expect(progress.current).toBeNull()
  })

  it('is not complete while signed out, whatever else is ticked', () => {
    const progress = onboardingSteps({
      ...fresh,
      installed: true,
      isOnToolbar: true,
      learningEnabled: true,
    })
    expect(progress.complete).toBe(false)
    expect(progress.current).toBe('sign-in')
  })

  it('gives every step its English copy', () => {
    for (const step of onboardingSteps(fresh).steps) {
      expect(step.title).toMatch(/^[A-Z]/)
    }
  })
})
