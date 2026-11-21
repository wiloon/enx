import { config } from '@/config/env'
import AiWordFallbackSetting from '@/components/AiWordFallbackSetting'
import ArticleChoiceSharingSetting from '@/components/ArticleChoiceSharingSetting'
import '@/index.css'
import { initSentry } from '@/lib/sentry'
import { useWordHighlightEnabled } from '@/hooks/useWordHighlightEnabled'
import { useHoverSentenceTranslate } from '@/hooks/useHoverSentenceTranslate'
import { Provider } from 'jotai'

initSentry()

function OptionsContent() {
  const { enabled: wordHighlightEnabled, setEnabled: setWordHighlightEnabled } =
    useWordHighlightEnabled()
  const {
    translateEnabled: hoverTranslateEnabled,
    setTranslateEnabled: setHoverTranslateEnabled,
    shadeEnabled: hoverShadeEnabled,
    setShadeEnabled: setHoverShadeEnabled,
  } = useHoverSentenceTranslate()

  return (
    <div className="min-h-screen bg-muted p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-foreground mb-8">
          Catglish Extension Options
        </h1>

        {/* Current Environment Info: fixed when the extension is built */}
        <div className="bg-brand-muted border border-brand/25 rounded-lg p-4 mb-6">
          <h3 className="text-sm font-semibold text-brand mb-2">
            Current Environment
          </h3>
          <p className="text-sm text-brand">
            <span className="font-medium">Mode:</span> {config.environment}
          </p>
          <p className="text-sm text-brand">
            <span className="font-medium">API:</span> {config.apiBaseUrl}
          </p>
        </div>

        {/* Reading Preferences */}
        <div className="bg-background rounded-lg shadow-lg p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4 text-foreground">
            Reading Preferences
          </h2>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              data-testid="word-highlight-toggle"
              checked={wordHighlightEnabled}
              onChange={e => setWordHighlightEnabled(e.target.checked)}
              className="mt-1 h-4 w-4 rounded-sm border-border text-brand focus:ring-brand"
            />
            <span>
              <span className="block text-sm font-medium text-foreground">
                Highlight vocabulary while reading
              </span>
              <span className="block text-sm text-muted-foreground">
                Underlines the words you&apos;ve looked up, wherever they
                appear. Turn off for a clean page — you can still click any word
                to look it up.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3 cursor-pointer mt-4">
            <input
              type="checkbox"
              data-testid="hover-sentence-translate-toggle"
              checked={hoverTranslateEnabled}
              onChange={e => setHoverTranslateEnabled(e.target.checked)}
              className="mt-1 h-4 w-4 rounded-sm border-border text-brand focus:ring-brand"
            />
            <span>
              <span className="block text-sm font-medium text-foreground">
                Show a translate button at the end of the sentence under the
                pointer
              </span>
              <span className="block text-sm text-muted-foreground">
                After a short pause on a word, a translate button appears at
                that sentence&apos;s end. It does not look the word up.
              </span>
            </span>
          </label>
          <label
            className={`flex items-start gap-3 mt-4 ${
              hoverTranslateEnabled ? 'cursor-pointer' : 'opacity-60'
            }`}
          >
            <input
              type="checkbox"
              data-testid="hover-sentence-shade-toggle"
              checked={hoverShadeEnabled}
              disabled={!hoverTranslateEnabled}
              onChange={e => setHoverShadeEnabled(e.target.checked)}
              className="mt-1 h-4 w-4 rounded-sm border-border text-brand focus:ring-brand disabled:cursor-not-allowed"
            />
            <span>
              <span className="block text-sm font-medium text-foreground">
                Shade the sentence under the pointer
              </span>
              <span className="block text-sm text-muted-foreground">
                A light wash marks the sentence the translate button will send.
              </span>
            </span>
          </label>
        </div>

        {/* AI word lookup (stored in the account, ADR-044) */}
        <div className="bg-background rounded-lg shadow-lg p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4 text-foreground">
            AI Word Lookup
          </h2>
          <AiWordFallbackSetting />
        </div>

        {/* Article choice sharing (ADR-073), asked by the popup first */}
        <div className="bg-background rounded-lg shadow-lg p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4 text-foreground">
            Article Detection
          </h2>
          <ArticleChoiceSharingSetting />
        </div>
      </div>
    </div>
  )
}

export default function Options() {
  return (
    <Provider>
      <OptionsContent />
    </Provider>
  )
}
