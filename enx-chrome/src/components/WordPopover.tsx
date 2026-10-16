import { useEffect, useRef } from 'react'
import { useAtom } from 'jotai'
import {
  ArrowPathRoundedSquareIcon,
  BookOpenIcon,
  SpeakerWaveIcon,
  XMarkIcon,
} from '@heroicons/react/20/solid'
import SidePanelTranslateIcon from '@/components/icons/SidePanelTranslateIcon'
import { AiBadge, AiMissPanel, AiNotice } from '@/components/AiLookup'
import LoadingSkeleton from '@/components/LoadingSkeleton'
import { lookupCountLabel } from '@/lib/lookupCount'
import {
  currentWordAtom,
  isTranslatingAtom,
  errorAtom,
  errorNeedsReloadAtom,
  sentencePanelHintAtom,
} from '@/store/atoms'
import { formatPhonetic } from '@/lib/phonetic'
import { playPronunciation } from '@/lib/pronunciation'

interface WordPopoverProps {
  word: string
  onClose: () => void
  onMarkKnown: (word: string) => void
  onOpenSentencePanel: () => void
  // The "Look up with AI" button after a lookup that found nothing (ADR-045).
  onAiLookup?: () => void
  // The "Reload page" button under an error that only a reload fixes (an
  // extension reload or update cut this tab's script off).
  onReloadPage?: () => void
  // 'hint': renders only the sentencePanelHint text, no dictionary UI.
  // Used by the drag-select translation flow (ADR-007 Decision §4) when
  // there's nothing to define -- either the selection was rejected for
  // being too long, or chrome.sidePanel.open() needs a manual fallback.
  variant?: 'dictionary' | 'hint'
}

export default function WordPopover({
  word,
  onClose,
  onMarkKnown,
  onOpenSentencePanel,
  onAiLookup = () => {},
  onReloadPage = () => window.location.reload(),
  variant = 'dictionary',
}: WordPopoverProps) {
  const [currentWord] = useAtom(currentWordAtom)
  const [isTranslating] = useAtom(isTranslatingAtom)
  const [error] = useAtom(errorAtom)
  const [errorNeedsReload] = useAtom(errorNeedsReloadAtom)
  const [sentencePanelHint] = useAtom(sentencePanelHintAtom)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Auto-focus for keyboard navigation. Uses a ref rather than
    // document.getElementById: this component renders inside a shadow root,
    // and document.getElementById cannot reach across the shadow boundary.
    rootRef.current?.focus()
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
    } else if (e.key === 'Enter' && currentWord) {
      onMarkKnown(currentWord.English)
    }
  }

  const getYoudaoUrl = (word: string) => {
    return `https://www.youdao.com/result?word=${encodeURIComponent(word)}&lang=en`
  }

  if (variant === 'hint') {
    return (
      <div
        ref={rootRef}
        className="bg-background rounded-lg shadow-xl border border-border p-3 w-full outline-hidden"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <div className="flex justify-between items-start">
          <span className="text-sm text-muted-foreground">
            Selection translation
          </span>
          <button
            data-testid="word-popover-close"
            onClick={onClose}
            className="text-muted-foreground hover:text-destructive ml-2"
            title="Close"
            aria-label="Close"
          >
            <XMarkIcon className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        {sentencePanelHint && (
          <div
            data-testid="word-popover-sentence-panel-hint"
            className="mt-2 p-2 bg-brand-muted border border-brand/25 rounded-sm text-brand text-xs"
          >
            {sentencePanelHint}
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      ref={rootRef}
      className="bg-background rounded-lg shadow-xl border border-border p-3 w-full outline-hidden flex flex-col min-h-0"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      {/* Header: word + phonetic + play + query count all on one line */}
      <div
        data-testid="word-popover-header"
        className="flex justify-between items-center gap-2 mb-2 shrink-0"
      >
        <div className="flex flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5 min-w-0">
          <h3 className="text-lg font-bold text-foreground leading-tight">
            {currentWord?.English || word}
          </h3>
          {formatPhonetic(currentWord?.Pronunciation) && (
            <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
              {formatPhonetic(currentWord?.Pronunciation)}
              <button
                data-testid="word-popover-play-pronunciation"
                type="button"
                onClick={() =>
                  currentWord && playPronunciation(currentWord.English)
                }
                className="text-muted-foreground hover:text-brand leading-none p-1 -m-1"
                title="Play pronunciation"
              >
                <SpeakerWaveIcon
                  className="h-3.5 w-3.5 block"
                  aria-hidden="true"
                />
              </button>
            </span>
          )}
          {currentWord?.LoadCount !== undefined && (
            <span
              className="inline-flex items-center gap-0.5 text-xs text-muted-foreground"
              title={lookupCountLabel(currentWord.LoadCount)}
            >
              <ArrowPathRoundedSquareIcon
                className="h-3 w-3"
                aria-hidden="true"
              />
              <span aria-hidden="true">{currentWord.LoadCount}</span>
              <span className="sr-only">
                {lookupCountLabel(currentWord.LoadCount)}
              </span>
            </span>
          )}
        </div>
        <button
          data-testid="word-popover-close"
          onClick={onClose}
          className="text-muted-foreground hover:text-destructive ml-1 shrink-0"
          title="Close"
          aria-label="Close"
        >
          <XMarkIcon className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {/* Only this part scrolls when the overlay is short of room; the
          header above and the actions below always stay in view. */}
      <div
        data-testid="word-popover-content"
        className="min-h-0 overflow-y-auto"
      >
        {/* Loading state */}
        {isTranslating && (
          <LoadingSkeleton
            label="Loading translation"
            testId="word-popover-loading"
          />
        )}

        {/* Error state */}
        {error && !isTranslating && (
          <div
            data-testid="word-popover-error"
            className="p-3 bg-destructive/10 border border-destructive/25 rounded-sm mb-3"
          >
            <p className="text-destructive text-sm">{error}</p>
            {errorNeedsReload && (
              <button
                data-testid="word-popover-reload-page"
                type="button"
                onClick={onReloadPage}
                className="mt-2 px-3 py-1 text-xs font-medium rounded-sm bg-brand text-brand-foreground hover:bg-brand/90"
              >
                Reload page
              </button>
            )}
          </div>
        )}

        {/* Word content */}
        {currentWord && !isTranslating && !error && (
          <div className="space-y-2">
            {/* Chinese translation; a definition a model wrote is marked as
                such (ADR-045). With none, the AI fallback's state is shown. */}
            {currentWord.Chinese ? (
              <div className="flex items-start gap-2">
                <p className="text-sm leading-relaxed text-foreground">
                  {currentWord.Chinese}
                </p>
                {currentWord.Origin === 'ai' && <AiBadge />}
              </div>
            ) : (
              <AiMissPanel onLookup={onAiLookup} />
            )}
            <AiNotice />

            {/* Known status */}
            {currentWord.Known && (
              <div className="text-success text-sm font-medium">✓ Known</div>
            )}
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="shrink-0">
        <div className="flex justify-between items-center mt-3 pt-2 border-t border-border">
          <div className="flex items-center gap-3">
            <a
              href={getYoudaoUrl(currentWord?.English || word)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-brand hover:text-brand/80 text-sm"
              title="Open in Youdao Dictionary"
            >
              <BookOpenIcon className="h-4 w-4" aria-hidden="true" />
              Youdao
            </a>
            <button
              data-testid="word-popover-sentence-translation"
              onClick={onOpenSentencePanel}
              className="inline-flex items-center text-brand hover:text-brand/80"
              title="Sentence translation (translate the whole sentence in the side panel)"
              aria-label="Sentence translation"
            >
              <SidePanelTranslateIcon className="h-5 w-5" />
            </button>
          </div>

          {currentWord && !currentWord.Known && (
            <button
              data-testid="word-popover-mark-known"
              onClick={() => onMarkKnown(currentWord.English)}
              className="bg-brand hover:bg-brand/90 text-brand-foreground text-sm px-3 py-1 rounded-sm transition-colors"
              title="Mark as known"
            >
              ✓ Know It
            </button>
          )}
        </div>

        {/* Trigger path③ (see spec §3.2) best-effort hint: shown when
            chrome.sidePanel.open() couldn't be triggered directly because the
            click's user gesture didn't survive being forwarded through
            runtime.sendMessage -- not an error, just guidance to a reliable
            fallback path. */}
        {sentencePanelHint && (
          <div
            data-testid="word-popover-sentence-panel-hint"
            className="mt-2 p-2 bg-brand-muted border border-brand/25 rounded-sm text-brand text-xs"
          >
            {sentencePanelHint}
          </div>
        )}
      </div>
    </div>
  )
}
