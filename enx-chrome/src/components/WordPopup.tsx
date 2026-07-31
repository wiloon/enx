import { useEffect, useRef } from 'react'
import { useAtom } from 'jotai'
import {
  currentWordAtom,
  isTranslatingAtom,
  errorAtom,
  sentencePanelHintAtom,
} from '@/store/atoms'

interface WordPopupProps {
  word: string
  onClose: () => void
  onMarkAcquainted: (word: string) => void
  onOpenSentencePanel: () => void
}

export default function WordPopup({
  word,
  onClose,
  onMarkAcquainted,
  onOpenSentencePanel,
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

  return (
    <div
      ref={rootRef}
      className="bg-white rounded-lg shadow-xl border border-gray-200 p-4 w-full outline-none"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      {/* Header with word */}
      <div
        data-testid="word-popup-header"
        className="flex justify-between items-start mb-3"
      >
        <div className="flex-1">
          <h3 className="text-lg font-bold text-gray-800">
            {currentWord?.English || word}
          </h3>
          {currentWord?.LoadCount !== undefined && (
            <span className="text-xs text-gray-500">
              Query Count: {currentWord.LoadCount}
            </span>
          )}
        </div>
        <button
          data-testid="word-popup-close"
          onClick={onClose}
          className="text-gray-400 hover:text-red-500 text-xl leading-none ml-2"
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
          <div className="space-y-3">
            {/* Pronunciation */}
            {currentWord.Pronunciation && (
              <div>
                <span className="text-gray-600 font-medium">
                  {currentWord.Pronunciation}
                </span>
              </div>
            )}

            {/* Chinese translation */}
            {currentWord.Chinese && (
              <div>
                <p className="text-gray-800">{currentWord.Chinese}</p>
              </div>
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
        <div className="flex justify-between items-center mt-4 pt-3 border-t border-gray-100">
          <div className="flex space-x-2">
            <a
              href={getYoudaoUrl(currentWord?.English || word)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-500 hover:text-blue-600 text-sm"
              title="Open in Youdao Dictionary"
            >
              📚 Youdao
            </a>
            <button
              data-testid="word-popup-sentence-translation"
              onClick={onOpenSentencePanel}
              className="text-blue-500 hover:text-blue-600 text-sm"
              title="Translate the whole sentence in the side panel"
            >
              🔤 整句翻译
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
