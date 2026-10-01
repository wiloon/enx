import { config } from '@/config/env'
import { useAiWordFallback } from '@/hooks/useAiWordFallback'

// The setting is stored in the user's account, so the website's Settings page
// shows the same value (ADR-044).
export default function AiWordFallbackSetting() {
  const { state, saving, saveError, setEnabled } = useAiWordFallback()

  if (state.status === 'loading') {
    return <p className="text-sm text-muted-foreground">Loading...</p>
  }
  if (state.status === 'signed-out') {
    return (
      <p className="text-sm text-muted-foreground">
        Sign in from the Catglish toolbar popup to manage this setting.
      </p>
    )
  }

  const unavailable = state.status === 'unavailable'
  const view = unavailable ? state.cached : state.view

  if (!view) {
    return (
      <p className="text-sm text-destructive">
        Couldn&apos;t load this setting. Check that the API is reachable (see
        Active API above), then reload this page.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          data-testid="ai-word-fallback-toggle"
          checked={view.effective}
          disabled={!view.editable || unavailable || saving}
          onChange={e => setEnabled(e.target.checked)}
          className="mt-1 h-4 w-4 rounded-sm border-border text-brand focus:ring-brand"
        />
        <span>
          <span className="block text-sm font-medium text-foreground">
            Look up unknown words with AI automatically
          </span>
          <span className="block text-sm text-muted-foreground">
            When a word isn&apos;t in the dictionary, Catglish can look it up
            with AI. Only the word itself is sent to an AI provider, never the
            sentence or the page. Each AI lookup uses credits. This setting is
            stored in your account, so it also applies on the Catglish website.
          </span>
        </span>
      </label>

      {!view.editable && (
        <p className="text-sm text-foreground">
          AI lookup is available with a subscription or a credit balance.{' '}
          <a
            href={`${config.frontendBaseUrl}/billing`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand hover:underline font-medium"
          >
            Subscribe / add credit
          </a>
        </p>
      )}
      {unavailable && (
        <p className="text-sm text-muted-foreground">
          Couldn&apos;t reach the server, so this is the last value it gave this
          device and can&apos;t be changed right now.
        </p>
      )}
      {saveError && (
        <p role="alert" className="text-sm text-destructive">
          {saveError}
        </p>
      )}
    </div>
  )
}
