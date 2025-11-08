import { useEffect } from 'react'
import { useAtom } from 'jotai'
import {
  currentWordAtom,
  userAtom,
  isTranslatingAtom,
  errorAtom,
} from '@/store/atoms'

interface WordPopupProps {
  word: string
  position: { x: number; y: number }
  onClose: () => void
  onMarkAcquainted: (word: string) => void
}

export default function WordPopup({
  word,
  position,
  onClose,
  onMarkAcquainted,
}: WordPopupProps) {
  const [currentWord] = useAtom(currentWordAtom)
  const [user] = useAtom(userAtom)
  const [isTranslating] = useAtom(isTranslatingAtom)
  const [error] = useAtom(errorAtom)

  useEffect(() => {
    // Auto-focus for keyboard navigation
    const popup = document.getElementById('enx-word-popup')
    if (popup) {
      popup.focus()
    }
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
      id="enx-word-popup"
      className="fixed bg-white rounded-lg shadow-xl border border-gray-200 p-4 z-50 max-w-xs min-w-[320px]"
      style={{
        left: position.x,
        top: position.y,
        maxHeight: '300px',
      }}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      {/* Header with word */}
      <div className="flex justify-between items-start mb-3">
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
          onClick={onClose}
          className="text-gray-400 hover:text-red-500 text-xl leading-none ml-2"
          title="Close"
        >
          ×
        </button>
      </div>

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
        <div className="p-3 bg-red-50 border border-red-200 rounded mb-3">
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
        </div>

        {user.isLoggedIn &&
          currentWord &&
          currentWord.AlreadyAcquainted !== 1 && (
            <button
              onClick={() => onMarkAcquainted(currentWord.English)}
              className="bg-green-500 hover:bg-green-600 text-white text-sm px-3 py-1 rounded transition-colors"
              title="Mark as acquainted"
            >
              ✓ Mark Known
            </button>
          )}
      </div>
    </div>
  )
}
