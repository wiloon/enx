import { useExplanationLanguage } from '@/hooks/useExplanationLanguage'
import {
  EXPLANATION_LANGUAGES,
  SAVE_FAILED_MESSAGE,
} from '@/lib/explanationLanguage'

// The word popover's 中 / EN switch (ADR-098 Decision 1): saves on click.
// Rendered into the header row; the error wraps onto its own line below.
export default function ExplanationLanguageSwitch() {
  const { state, control, choose } = useExplanationLanguage()
  if (!control) return null

  return (
    <>
      <div
        role="group"
        aria-label="Explanation language"
        className="inline-flex shrink-0 rounded-sm border border-brand/40"
      >
        {EXPLANATION_LANGUAGES.map(({ value, mark, name }) => {
          const selected = control.selected === value
          return (
            <button
              key={value}
              type="button"
              aria-label={name}
              aria-pressed={selected}
              title={`Explanation language: ${name}`}
              disabled={control.disabled}
              onClick={() => void choose(value)}
              className={`min-w-7 px-1.5 py-1 text-xs font-medium leading-none first:rounded-l-[3px] last:rounded-r-[3px] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand disabled:cursor-default disabled:opacity-60 ${
                selected
                  ? 'bg-brand text-brand-foreground'
                  : 'text-brand enabled:hover:bg-brand-muted enabled:active:bg-brand/20'
              }`}
            >
              {mark}
            </button>
          )
        })}
      </div>
      {state.saveFailed && (
        <p
          role="alert"
          className="order-last w-full text-right text-xs text-destructive"
        >
          {SAVE_FAILED_MESSAGE}
        </p>
      )}
    </>
  )
}
