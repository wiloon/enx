// The popup's main control for this tab. Off, it is the one filled brand
// button; on, it becomes a quiet status card with its own Turn off, so the two
// states look different at a glance and a stray click can't re-run the page.
// The copy is about reading with the tool at hand, not a "learning" chore.

import { CheckCircleIcon, SparklesIcon } from '@heroicons/react/24/outline'

export type LearningModeCardStatus = 'off' | 'enabling' | 'on' | 'turning-off'

interface LearningModeCardProps {
  status: LearningModeCardStatus
  onEnable: () => void
  onTurnOff: () => void
}

export default function LearningModeCard({
  status,
  onEnable,
  onTurnOff,
}: LearningModeCardProps) {
  if (status === 'on' || status === 'turning-off') {
    return (
      <div
        role="status"
        data-testid="learning-mode-card"
        className="flex items-center gap-3 rounded-xl bg-brand-muted px-3 py-2.5 ring-1 ring-brand/40"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand text-brand-foreground">
          <CheckCircleIcon className="h-[18px] w-[18px]" />
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block text-sm font-semibold text-foreground">
            Catglish is on
          </span>
          <span className="block text-[11px] text-muted-foreground">
            Click any word to look it up
          </span>
        </span>
        <button
          type="button"
          data-testid="learning-mode-turn-off"
          onClick={onTurnOff}
          disabled={status === 'turning-off'}
          className="shrink-0 rounded-lg bg-background px-2.5 py-1 text-xs font-medium text-foreground ring-1 ring-border transition hover:ring-brand/50 disabled:opacity-60"
        >
          {status === 'turning-off' ? 'Turning off…' : 'Turn off'}
        </button>
      </div>
    )
  }

  return (
    <button
      type="button"
      data-testid="learning-mode-enable"
      onClick={onEnable}
      disabled={status === 'enabling'}
      className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-2.5 text-sm font-semibold text-brand-foreground shadow-md shadow-brand/25 transition hover:brightness-105 active:scale-[0.99] disabled:opacity-60"
    >
      <SparklesIcon className="h-[18px] w-[18px]" />
      {status === 'enabling' ? 'Enabling…' : 'Read with Catglish'}
    </button>
  )
}
