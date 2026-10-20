import {
  learningModeShortcut,
  runLearningModeCommand,
  TOGGLE_LEARNING_MODE_COMMAND,
  type LearningModeCommandDeps,
} from '@/lib/learningModeCommand'
import type { LearningModeStatus } from '@/lib/learningModeStatus'

const TAB_ID = 7

const makeDeps = (
  status: LearningModeStatus,
  overrides: Partial<LearningModeCommandDeps> = {}
) => {
  const deps = {
    getStatus: jest.fn().mockResolvedValue(status),
    enable: jest.fn().mockResolvedValue({ success: true }),
    disable: jest.fn().mockResolvedValue(undefined),
    isSignedIn: jest.fn().mockResolvedValue(true),
    showOnBadge: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  }
  return deps
}

describe('runLearningModeCommand', () => {
  afterEach(() => jest.restoreAllMocks())

  it('turns learning mode on when it is off on the tab', async () => {
    const deps = makeDeps({ status: 'off' })

    const result = await runLearningModeCommand(
      TOGGLE_LEARNING_MODE_COMMAND,
      TAB_ID,
      deps
    )

    expect(result).toBe('enabled')
    expect(deps.enable).toHaveBeenCalledWith(TAB_ID)
    expect(deps.disable).not.toHaveBeenCalled()
    expect(deps.showOnBadge).not.toHaveBeenCalled()
  })

  it('turns learning mode off when it is on', async () => {
    const deps = makeDeps({ status: 'ready' })

    const result = await runLearningModeCommand(
      TOGGLE_LEARNING_MODE_COMMAND,
      TAB_ID,
      deps
    )

    expect(result).toBe('disabled')
    expect(deps.disable).toHaveBeenCalledWith(TAB_ID)
    expect(deps.enable).not.toHaveBeenCalled()
  })

  // enxStop can't cancel a run still preparing the article: it would finish,
  // paint and report ready with the page believing it is off. So the key
  // waits, as the popup does, rather than stopping or starting over.
  it('does nothing while the page is still processing', async () => {
    const deps = makeDeps({ status: 'processing' })

    const result = await runLearningModeCommand(
      TOGGLE_LEARNING_MODE_COMMAND,
      TAB_ID,
      deps
    )

    expect(result).toBe('ignored')
    expect(deps.disable).not.toHaveBeenCalled()
    expect(deps.enable).not.toHaveBeenCalled()
    expect(deps.showOnBadge).not.toHaveBeenCalled()
  })

  // The popup offers no enable button signed out. The key says why on the
  // badge, as a granted auto-enable site does (adr-046 Decision 7).
  it('asks to sign in on the badge instead of enabling when signed out', async () => {
    const deps = makeDeps(
      { status: 'off' },
      { isSignedIn: jest.fn().mockResolvedValue(false) }
    )

    const result = await runLearningModeCommand(
      TOGGLE_LEARNING_MODE_COMMAND,
      TAB_ID,
      deps
    )

    expect(result).toBe('failed')
    expect(deps.enable).not.toHaveBeenCalled()
    expect(deps.showOnBadge).toHaveBeenCalledWith(TAB_ID, {
      status: 'error',
      reason: 'signed-out',
    })
  })

  it('still turns learning mode off when signed out', async () => {
    const deps = makeDeps(
      { status: 'ready' },
      { isSignedIn: jest.fn().mockResolvedValue(false) }
    )

    const result = await runLearningModeCommand(
      TOGGLE_LEARNING_MODE_COMMAND,
      TAB_ID,
      deps
    )

    expect(result).toBe('disabled')
    expect(deps.disable).toHaveBeenCalledWith(TAB_ID)
  })

  it('retries after a failed run, as the popup button does', async () => {
    const deps = makeDeps({ status: 'error', reason: 'lookup-failed' })

    await runLearningModeCommand(TOGGLE_LEARNING_MODE_COMMAND, TAB_ID, deps)

    expect(deps.enable).toHaveBeenCalledWith(TAB_ID)
  })

  // The popup isn't open to show its error line, so the badge is the only
  // place left: the same status the content script would put there.
  it('puts an actionable enable failure on the badge', async () => {
    const deps = makeDeps(
      { status: 'off' },
      {
        enable: jest.fn().mockResolvedValue({
          success: false,
          reason: 'error',
          error: 'Something went wrong while processing this page.',
        }),
      }
    )

    const result = await runLearningModeCommand(
      TOGGLE_LEARNING_MODE_COMMAND,
      TAB_ID,
      deps
    )

    expect(result).toBe('failed')
    expect(deps.showOnBadge).toHaveBeenCalledWith(TAB_ID, {
      status: 'error',
      reason: 'error',
    })
  })

  // adr-046: a page Catglish can't run on leaves the badge empty, as it does
  // after the popup's button; there is no new notification type.
  it('leaves the badge empty for a failure the badge does not show', async () => {
    const deps = makeDeps(
      { status: 'off' },
      {
        enable: jest.fn().mockResolvedValue({
          success: false,
          reason: 'injection-blocked',
        }),
      }
    )

    const result = await runLearningModeCommand(
      TOGGLE_LEARNING_MODE_COMMAND,
      TAB_ID,
      deps
    )

    expect(result).toBe('failed')
    expect(deps.showOnBadge).toHaveBeenCalledWith(TAB_ID, { status: 'off' })
  })

  it('shows `!` when enabling throws', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    const deps = makeDeps(
      { status: 'off' },
      { enable: jest.fn().mockRejectedValue(new Error('boom')) }
    )

    const result = await runLearningModeCommand(
      TOGGLE_LEARNING_MODE_COMMAND,
      TAB_ID,
      deps
    )

    expect(result).toBe('failed')
    expect(deps.showOnBadge).toHaveBeenCalledWith(TAB_ID, {
      status: 'error',
      reason: 'error',
    })
  })

  it('ignores any other command', async () => {
    const deps = makeDeps({ status: 'off' })

    const result = await runLearningModeCommand('something-else', TAB_ID, deps)

    expect(result).toBe('ignored')
    expect(deps.getStatus).not.toHaveBeenCalled()
    expect(deps.enable).not.toHaveBeenCalled()
    expect(deps.disable).not.toHaveBeenCalled()
  })

  it('ignores the command when there is no tab', async () => {
    const deps = makeDeps({ status: 'off' })

    const result = await runLearningModeCommand(
      TOGGLE_LEARNING_MODE_COMMAND,
      undefined,
      deps
    )

    expect(result).toBe('ignored')
    expect(deps.enable).not.toHaveBeenCalled()
  })
})

// The suggested key is only a suggestion: Chrome leaves the command unbound
// when Alt+C is taken, and the user can rebind it. The popup shows whatever
// chrome.commands.getAll() reports.
describe('learningModeShortcut', () => {
  const popupCommand = {
    name: '_execute_action',
    shortcut: 'Ctrl+Shift+E',
  }

  it('reports the key Chrome bound to the toggle', () => {
    expect(
      learningModeShortcut([
        popupCommand,
        { name: 'toggle-learning-mode', shortcut: '⌥C' },
      ])
    ).toEqual({ bound: true, key: '⌥C' })
  })

  it('reports unbound when Chrome left the shortcut empty', () => {
    expect(
      learningModeShortcut([
        popupCommand,
        { name: 'toggle-learning-mode', shortcut: '' },
      ])
    ).toEqual({ bound: false })
  })

  it('reports unbound when the command is missing', () => {
    expect(learningModeShortcut([popupCommand])).toEqual({ bound: false })
  })
})
