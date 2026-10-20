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
    report: jest.fn().mockResolvedValue(undefined),
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
    expect(deps.report).not.toHaveBeenCalled()
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

  // Pressing the key again while the article is still being prepared means
  // "stop", not "start over".
  it('turns learning mode off while the page is still processing', async () => {
    const deps = makeDeps({ status: 'processing' })

    await runLearningModeCommand(TOGGLE_LEARNING_MODE_COMMAND, TAB_ID, deps)

    expect(deps.disable).toHaveBeenCalledWith(TAB_ID)
    expect(deps.enable).not.toHaveBeenCalled()
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
    expect(deps.report).toHaveBeenCalledWith(TAB_ID, {
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
    expect(deps.report).toHaveBeenCalledWith(TAB_ID, { status: 'off' })
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
    expect(deps.report).toHaveBeenCalledWith(TAB_ID, {
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
