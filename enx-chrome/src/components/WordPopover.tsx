import { useEffect, useRef } from 'react'
import { useAtom } from 'jotai'
import {
  ArrowPathRoundedSquareIcon,
  BookOpenIcon,
  SpeakerWaveIcon,
} from '@heroicons/react/20/solid'
import SidePanelTranslateIcon from '@/components/icons/SidePanelTranslateIcon'
import {
  currentWordAtom,
  isTranslatingAtom,
  errorAtom,
  sentencePanelHintAtom,
} from '@/store/atoms'
import { formatPhonetic } from '@/lib/phonetic'
import { playPronunciation } from '@/lib/pronunciation'

interface WordPopoverProps {
  word: string
  onClose: () => void
  onMarkAcquainted: (word: string) => void
  onOpenSentencePanel: () => void
  // 'hint': renders only the sentencePanelHint text, no dictionary UI.
  // Used by the drag-select translation flow (ADR-007 Decision §4) when
  // there's nothing to define -- either the selection was rejected for
  // being too long, or chrome.sidePanel.open() needs a manual fallback.
  variant?: 'dictionary' | 'hint'
}

export default function WordPopover({
  word,
  onClose,
  onMarkAcquainted,
  onOpenSentencePanel,
  variant = 'dictionary',
}: WordPopoverProps) {
  const [currentWord] = useAtom(currentWordAtom)
  const [isTranslating] = useAtom(isTranslatingAtom)
  const [error] = useAtom(errorAtom)
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
      onMarkAcquainted(currentWord.English)
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
          <span className="text-sm text-muted-foreground">Selection translation</span>
          <button
            data-testid="word-popover-close"
            onClick={onClose}
            className="text-muted-foreground hover:text-destructive text-xl leading-none ml-2"
            title="Close"
          >
            ×
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
      className="bg-background rounded-lg shadow-xl border border-border p-3 w-full outline-hidden"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      {/* Header: word + phonetic + play + query count all on one line */}
      <div
        data-testid="word-popover-header"
        className="flex justify-between items-center gap-2 mb-2"
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
                onClick={() => currentWord && playPronunciation(currentWord.English)}
                className="text-muted-foreground hover:text-brand leading-none p-1 -m-1"
                title="Play pronunciation"
              >
                <SpeakerWaveIcon className="h-3.5 w-3.5 block" aria-hidden="true" />
              </button>
            </span>
          )}
          {currentWord?.LoadCount !== undefined && (
            <span
              className="inline-flex items-center gap-0.5 text-xs text-muted-foreground"
              title={`Query Count: ${currentWord.LoadCount}`}
            >
              <ArrowPathRoundedSquareIcon className="h-3 w-3" aria-hidden="true" />
              {currentWord.LoadCount}
            </span>
          )}
        </div>
        <button
          data-testid="word-popover-close"
          onClick={onClose}
          className="text-muted-foreground hover:text-destructive text-xl leading-none ml-1 shrink-0"
          title="Close"
        >
          ×
        </button>
      </div>

      <div data-testid="word-popover-content">
        {/* Loading state */}
        {isTranslating && (
          <div className="space-y-3">
            <div className="animate-pulse">
              <div className="h-4 bg-muted rounded-sm w-3/4 mb-2"></div>
              <div className="h-4 bg-muted rounded-sm w-1/2"></div>
            </div>
            <div className="text-center text-muted-foreground text-sm">
              <span className="inline-block animate-spin mr-2">⏳</span>
              Loading translation...
            </div>
          </div>
        )}

        {/* Error state */}
        {error && !isTranslating && (
          <div
            data-testid="word-popover-error"
            className="p-3 bg-destructive/10 border border-destructive/25 rounded-sm mb-3"
          >
            <p className="text-destructive text-sm">{error}</p>
          </div>
        )}

        {/* Word content */}
        {currentWord && !isTranslating && !error && (
          <div className="space-y-2">
            {/* Chinese translation */}
            {currentWord.Chinese && (
              <p className="text-sm leading-relaxed text-foreground">
                {currentWord.Chinese}
              </p>
            )}

            {/* Acquainted status */}
            {currentWord.AlreadyAcquainted === 1 && (
              <div className="text-success text-sm font-medium">
                ✓ Already acquainted
              </div>
            )}
          </div>
        )}

        {/* Action buttons */}
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

          {currentWord && currentWord.AlreadyAcquainted !== 1 && (
            <button
              data-testid="word-popover-mark-known"
              onClick={() => onMarkAcquainted(currentWord.English)}
              className="bg-success hover:bg-success/90 text-success-foreground text-sm px-3 py-1 rounded-sm transition-colors"
              title="Mark as acquainted"
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
