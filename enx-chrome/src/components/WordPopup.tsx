import { useEffect, useRef } from 'react'
import { useAtom } from 'jotai'
import {
  BookOpenIcon,
  MagnifyingGlassIcon,
  SpeakerWaveIcon,
} from '@heroicons/react/20/solid'
import SidePanelTranslateIcon from '@/components/icons/SidePanelTranslateIcon'
import {
  currentWordAtom,
  isTranslatingAtom,
  errorAtom,
  sentencePanelHintAtom,
} from '@/store/atoms'
import { playPronunciation } from '@/lib/pronunciation'

interface WordPopupProps {
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

export default function WordPopup({
  word,
  onClose,
  onMarkAcquainted,
  onOpenSentencePanel,
  variant = 'dictionary',
}: WordPopupProps) {
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
        className="bg-white rounded-lg shadow-xl border border-gray-200 p-3 w-full outline-none"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <div className="flex justify-between items-start">
          <span className="text-sm text-gray-500">划词翻译</span>
          <button
            data-testid="word-popup-close"
            onClick={onClose}
            className="text-gray-400 hover:text-red-500 text-xl leading-none ml-2"
            title="Close"
          >
            ×
          </button>
        </div>
        {sentencePanelHint && (
          <div
            data-testid="word-popup-sentence-panel-hint"
            className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded text-blue-700 text-xs"
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
      className="bg-white rounded-lg shadow-xl border border-gray-200 p-3 w-full outline-none"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      {/* Header: word + phonetic + play + query count all on one line */}
      <div
        data-testid="word-popup-header"
        className="flex justify-between items-center gap-2 mb-2"
      >
        <div className="flex flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5 min-w-0">
          <h3 className="text-lg font-bold text-gray-800 leading-tight">
            {currentWord?.English || word}
          </h3>
          {currentWord?.Pronunciation && (
            <span className="inline-flex items-center gap-1 text-sm text-gray-500">
              {currentWord.Pronunciation}
              <button
                data-testid="word-popup-play-pronunciation"
                type="button"
                onClick={() => playPronunciation(currentWord.English)}
                className="text-gray-400 hover:text-blue-500 leading-none"
                title="Play pronunciation"
              >
                <SpeakerWaveIcon className="h-3.5 w-3.5 block" aria-hidden="true" />
              </button>
            </span>
          )}
          {currentWord?.LoadCount !== undefined && (
            <span
              className="inline-flex items-center gap-0.5 text-xs text-gray-400"
              title={`Query Count: ${currentWord.LoadCount}`}
            >
              <MagnifyingGlassIcon className="h-3 w-3" aria-hidden="true" />
              {currentWord.LoadCount}
            </span>
          )}
        </div>
        <button
          data-testid="word-popup-close"
          onClick={onClose}
          className="text-gray-400 hover:text-red-500 text-xl leading-none ml-1 shrink-0"
          title="Close"
        >
          ×
        </button>
      </div>

      <div data-testid="word-popup-content">
        {/* Loading state */}
        {isTranslating && (
          <div className="space-y-3">
            <div className="animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
              <div className="h-4 bg-gray-200 rounded w-1/2"></div>
            </div>
            <div className="text-center text-gray-500 text-sm">
              <span className="inline-block animate-spin mr-2">⏳</span>
              Loading translation...
            </div>
          </div>
        )}

        {/* Error state */}
        {error && !isTranslating && (
          <div
            data-testid="word-popup-error"
            className="p-3 bg-red-50 border border-red-200 rounded mb-3"
          >
            <p className="text-red-700 text-sm">{error}</p>
          </div>
        )}

        {/* Word content */}
        {currentWord && !isTranslating && !error && (
          <div className="space-y-2">
            {/* Chinese translation */}
            {currentWord.Chinese && (
              <p className="text-sm leading-relaxed text-gray-800">
                {currentWord.Chinese}
              </p>
            )}

            {/* Acquainted status */}
            {currentWord.AlreadyAcquainted === 1 && (
              <div className="text-green-600 text-sm font-medium">
                ✓ Already acquainted
              </div>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex justify-between items-center mt-3 pt-2 border-t border-gray-100">
          <div className="flex items-center gap-3">
            <a
              href={getYoudaoUrl(currentWord?.English || word)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-blue-500 hover:text-blue-600 text-sm"
              title="Open in Youdao Dictionary"
            >
              <BookOpenIcon className="h-4 w-4" aria-hidden="true" />
              Youdao
            </a>
            <button
              data-testid="word-popup-sentence-translation"
              onClick={onOpenSentencePanel}
              className="inline-flex items-center text-blue-500 hover:text-blue-600"
              title="整句翻译（在侧边栏翻译整句）"
              aria-label="整句翻译"
            >
              <SidePanelTranslateIcon className="h-5 w-5" />
            </button>
          </div>

          {currentWord && currentWord.AlreadyAcquainted !== 1 && (
            <button
              data-testid="word-popup-mark-known"
              onClick={() => onMarkAcquainted(currentWord.English)}
              className="bg-green-500 hover:bg-green-600 text-white text-sm px-3 py-1 rounded transition-colors"
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
            data-testid="word-popup-sentence-panel-hint"
            className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded text-blue-700 text-xs"
          >
            {sentencePanelHint}
          </div>
        )}
      </div>
    </div>
  )
}
