// The popup's main control for this tab. Off, it is the one filled brand
// button; on, it becomes a quiet status card with its own Turn off, so the two
// states look different at a glance and a stray click can't re-run the page.
// The copy is about reading with the tool at hand, not a "learning" chore.

import {
  CheckCircleIcon,
  CursorArrowRaysIcon,
} from '@heroicons/react/24/outline'
import { ArrowTopRightOnSquareIcon } from '@heroicons/react/20/solid'
import type { LearningModeShortcut } from '@/lib/learningModeCommand'

// Both states share one fixed height (the "on" card's 32px icon plus py-2.5),
// so turning Catglish on or off doesn't shift everything below the card.
const CARD_HEIGHT = 'h-13'

export type LearningModeCardStatus = 'off' | 'enabling' | 'on' | 'turning-off'

interface LearningModeCardProps {
  status: LearningModeCardStatus
  /** The toggle's key (#230); undefined until chrome.commands answers. */
  shortcut?: LearningModeShortcut
  onEnable: () => void
  onTurnOff: () => void
  /** Opens Chrome's page for binding the shortcut. */
  onSetShortcut: () => void
}

function ShortcutKey({ shortcut }: { shortcut?: LearningModeShortcut }) {
  if (!shortcut?.bound) return null
  return (
    <kbd className="font-sans text-[11px] font-normal opacity-70">
      {shortcut.key}
    </kbd>
  )
}

function LearningModeControl({
  status,
  shortcut,
  onEnable,
  onTurnOff,
}: LearningModeCardProps) {
  if (status === 'on' || status === 'turning-off') {
    return (
      <div
        role="status"
        data-testid="learning-mode-card"
        className={`flex ${CARD_HEIGHT} items-center gap-3 rounded-xl bg-brand-muted px-3 ring-1 ring-brand/40`}
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
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-background px-2.5 py-1 text-xs font-medium text-foreground ring-1 ring-border transition hover:ring-brand/50 disabled:opacity-60"
        >
          {status === 'turning-off' ? 'Turning off…' : 'Turn off'}
          <ShortcutKey shortcut={shortcut} />
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
      className={`relative flex ${CARD_HEIGHT} w-full items-center justify-center gap-2 rounded-xl bg-brand text-sm font-semibold text-brand-foreground shadow-md shadow-brand/25 transition hover:brightness-105 active:scale-[0.99] disabled:opacity-60`}
    >
      <CursorArrowRaysIcon className="h-[18px] w-[18px]" />
      {status === 'enabling' ? 'Enabling…' : 'Read with Catglish'}
      <span className="absolute right-3">
        <ShortcutKey shortcut={shortcut} />
      </span>
    </button>
  )
}

export default function LearningModeCard(props: LearningModeCardProps) {
  // Unbound: Chrome gave Alt+C to someone else, or the user cleared it. The
  // link sits outside the button so it can't be mis-clicked as "enable".
  const unbound = props.shortcut?.bound === false
  return (
    <div className="space-y-1">
      <LearningModeControl {...props} />
      {unbound && (
        <div className="flex justify-end">
          <button
            type="button"
            data-testid="learning-mode-set-shortcut"
            onClick={props.onSetShortcut}
            className="flex items-center gap-1 px-1 text-[11px] text-muted-foreground transition hover:text-foreground"
          >
            Set a shortcut
            <ArrowTopRightOnSquareIcon className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  )
}
