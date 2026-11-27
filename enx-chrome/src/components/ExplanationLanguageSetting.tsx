// The Options page's "Explanation language" dropdown (ADR-098 Decision 1),
// the same server preference as the word popover's switch.

import { useExplanationLanguage } from '@/hooks/useExplanationLanguage'
import {
  EXPLANATION_LANGUAGES,
  SAVE_FAILED_MESSAGE,
} from '@/lib/explanationLanguage'

export default function ExplanationLanguageSetting() {
  const { state, control, choose } = useExplanationLanguage()
  const { read, preferences } = state

  // Nothing to set: an older server (or cache) without the preference.
  if (read === 'ready' && !control) return null

  const note = (() => {
    if (read === 'loading' && !control) return 'Loading...'
    if (read === 'signed-out') {
      return 'Sign in from the Catglish toolbar popup to manage this setting.'
    }
    if (read !== 'unavailable') return null
    if (control) {
      return "Couldn't reach the server, so this is the last value it gave this device and can't be changed right now."
    }
    // A cached copy without the preference: nothing to show or to report.
    if (preferences) return null
    return "Couldn't load this setting. Check that the API is reachable (see Active API above), then reload this page."
  })()

  if (!control && !note) return null

  return (
    <div className="bg-background rounded-lg shadow-lg p-6 mb-6">
      <h2 className="text-xl font-semibold mb-4 text-foreground">
        Explanations
      </h2>
      {control && (
        <label className="flex flex-wrap items-center gap-3 text-sm font-medium text-foreground">
          Explanation language
          <select
            value={control.selected ?? ''}
            disabled={control.disabled}
            onChange={event => void choose(event.target.value)}
            className="rounded-md border border-border bg-background px-3 py-2 font-normal text-foreground enabled:hover:border-brand focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand disabled:opacity-60"
          >
            {/* A value this version doesn't know selects no language. */}
            {control.selected === null && <option value="" disabled />}
            {EXPLANATION_LANGUAGES.map(({ value, name }) => (
              <option key={value} value={value}>
                {name}
              </option>
            ))}
          </select>
        </label>
      )}
      {note && (
        <p className="mt-2 text-sm text-muted-foreground">{note}</p>
      )}
      {state.saveFailed && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {SAVE_FAILED_MESSAGE}
        </p>
      )}
    </div>
  )
}
