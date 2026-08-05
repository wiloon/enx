import { useCallback, useEffect, useState } from 'react'
import '@/index.css'
import { MagnifyingGlassIcon } from '@heroicons/react/20/solid'
import { initSentry } from '@/lib/sentry'
import { sendMessageToBackground } from '@/services/api'
import {
  BackgroundResponse,
  ContentMessage,
  PENDING_SENTENCE_STORAGE_KEY,
  PendingSentenceContext,
} from '@/types'

initSentry()

type Status = 'idle' | 'loading' | 'loaded' | 'error'

type FetchStatus = 'loading' | 'loaded' | 'error'

// Word click in the Side Panel now renders as a card (spec §3.9) rather than
// a single text line, so dictionary lookup (getOneWord) and AI contextual
// translation (translateWordInContext) each track their own status -- the
// card renders progressively, showing whichever half resolves first.
interface WordCardData {
  word: string
  pronunciation?: string
  loadCount?: number
  dictionaryChinese?: string
  dictionaryStatus: FetchStatus
  contextChinese?: string
  contextStatus: FetchStatus
}

interface SentenceToken {
  text: string
  clickable: boolean
}

// Splits a sentence into tokens, keeping whitespace/punctuation as separate
// non-clickable chunks so only actual words are clickable (spec §3.7).
const WORD_TOKEN = /[a-zA-Z][a-zA-Z'-]*/g
const tokenizeSentence = (sentence: string): SentenceToken[] => {
  const tokens: SentenceToken[] = []
  let lastIndex = 0

  for (const match of sentence.matchAll(WORD_TOKEN)) {
    const index = match.index ?? 0
    if (index > lastIndex) {
      tokens.push({ text: sentence.slice(lastIndex, index), clickable: false })
    }
    tokens.push({ text: match[0], clickable: true })
    lastIndex = index + match[0].length
  }
  if (lastIndex < sentence.length) {
    tokens.push({ text: sentence.slice(lastIndex), clickable: false })
  }

  return tokens
}

function SidePanelContent() {
  const [pendingContext, setPendingContext] = useState<PendingSentenceContext | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [chinese, setChinese] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [definitions, setDefinitions] = useState<WordCardData[]>([])

  // Load the pending context once on mount, then keep listening: if the
  // panel is already open and the user clicks "整句翻译" on another word on
  // the page, this fires again with the new context and the panel refreshes
  // in place -- no need to re-trigger sidePanel.open() (spec §3.3/§4.6).
  useEffect(() => {
    chrome.storage.session.get(PENDING_SENTENCE_STORAGE_KEY).then(result => {
      const stored = result[PENDING_SENTENCE_STORAGE_KEY] as
        | PendingSentenceContext
        | undefined
      if (stored) setPendingContext(stored)
    })

    const listener = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string
    ) => {
      if (areaName !== 'session') return
      const change = changes[PENDING_SENTENCE_STORAGE_KEY]
      if (change?.newValue) {
        setPendingContext(change.newValue as PendingSentenceContext)
      }
    }
    chrome.storage.onChanged.addListener(listener)
    return () => chrome.storage.onChanged.removeListener(listener)
  }, [])

  // Re-translate whenever a new sentence context arrives. Keyed on
  // createdAt so re-clicking the same sentence still re-triggers a fetch.
  useEffect(() => {
    if (!pendingContext) return

    let cancelled = false
    setStatus('loading')
    setErrorMessage('')
    setDefinitions([])

    sendMessageToBackground<BackgroundResponse>({
      type: 'translateSentence',
      sentence: pendingContext.sentence,
    } satisfies ContentMessage)
      .then(response => {
        if (cancelled) return
        if (response.success && response.chinese) {
          setChinese(response.chinese)
          setStatus('loaded')
        } else {
          setErrorMessage(response.error || 'Translation service unavailable')
          setStatus('error')
        }
      })
      .catch(error => {
        if (cancelled) return
        console.error('SidePanel: translateSentence failed', error)
        setErrorMessage('Translation service unavailable')
        setStatus('error')
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingContext?.createdAt])

  // Word click in the Side Panel fires two independent requests (spec
  // §3.7/§3.8/§3.9): getOneWord (same lookup the page's word popup uses --
  // pronunciation + dictionary Chinese + query count) and
  // translateWordInContext (AI translation of the word's meaning in this
  // specific sentence). Each updates only its own half of the card as soon
  // as it resolves -- the card renders progressively rather than waiting for
  // both. Re-clicking a word already in the list just moves its card to the
  // front instead of re-fetching (spec §3.9).
  const handleWordClick = useCallback(
    (rawWord: string) => {
      const word = rawWord.toLowerCase()
      const sentence = pendingContext?.sentence
      if (!sentence) return

      if (definitions.some(d => d.word === word)) {
        setDefinitions(prev => {
          const index = prev.findIndex(d => d.word === word)
          if (index === -1) return prev
          return [prev[index], ...prev.slice(0, index), ...prev.slice(index + 1)]
        })
        return
      }

      setDefinitions(prev => [
        { word, dictionaryStatus: 'loading', contextStatus: 'loading' },
        ...prev,
      ])

      sendMessageToBackground<BackgroundResponse>({
        type: 'getOneWord',
        word,
      } satisfies ContentMessage)
        .then(response => {
          setDefinitions(prev =>
            prev.map(d =>
              d.word === word
                ? {
                    ...d,
                    pronunciation: response.success ? response.ecp?.Pronunciation : undefined,
                    dictionaryChinese: response.success ? response.ecp?.Chinese : undefined,
                    loadCount: response.success ? response.ecp?.LoadCount : undefined,
                    dictionaryStatus: response.success ? 'loaded' : 'error',
                  }
                : d
            )
          )
        })
        .catch(() => {
          setDefinitions(prev =>
            prev.map(d => (d.word === word ? { ...d, dictionaryStatus: 'error' } : d))
          )
        })

      sendMessageToBackground<BackgroundResponse>({
        type: 'translateWordInContext',
        word,
        sentence,
      } satisfies ContentMessage)
        .then(response => {
          const resolved = response.success && response.chinese
          setDefinitions(prev =>
            prev.map(d =>
              d.word === word
                ? {
                    ...d,
                    contextChinese: resolved ? response.chinese : response.error || '翻译失败',
                    contextStatus: resolved ? 'loaded' : 'error',
                  }
                : d
            )
          )
        })
        .catch(() => {
          setDefinitions(prev =>
            prev.map(d =>
              d.word === word ? { ...d, contextStatus: 'error', contextChinese: '翻译失败' } : d
            )
          )
        })
    },
    [pendingContext?.sentence, definitions]
  )

  if (!pendingContext) {
    return (
      <div className="p-4 text-gray-500 text-sm" data-testid="sidepanel-empty-state">
        点击网页正文中任意已高亮的单词，然后点击弹窗里的「🔤 整句翻译」按钮，整句英文和中文翻译会显示在这里。
      </div>
    )
  }

  const tokens = tokenizeSentence(pendingContext.sentence)

  return (
    <div className="p-4 space-y-4 text-sm">
      <div>
        {pendingContext.sourceUrl && (
          <div
            className="text-xs text-gray-400 mb-1 truncate"
            title={pendingContext.sourceUrl}
            data-testid="sidepanel-source-url"
          >
            {pendingContext.sourceUrl}
          </div>
        )}
        <p className="text-gray-900 leading-relaxed" data-testid="sidepanel-sentence">
          {tokens.map((token, i) =>
            token.clickable ? (
              <button
                key={i}
                type="button"
                onClick={() => handleWordClick(token.text)}
                className="hover:bg-yellow-100 hover:underline rounded px-0.5"
              >
                {token.text}
              </button>
            ) : (
              <span key={i}>{token.text}</span>
            )
          )}
        </p>
      </div>

      <div className="border-t border-gray-100 pt-3">
        {status === 'loading' && (
          <div className="text-gray-500" data-testid="sidepanel-loading">
            <span className="inline-block animate-spin mr-2">⏳</span>
            翻译中...
          </div>
        )}
        {status === 'error' && (
          <div className="text-red-600" data-testid="sidepanel-error">
            {errorMessage}
          </div>
        )}
        {status === 'loaded' && (
          <p className="text-gray-800" data-testid="sidepanel-chinese">
            {chinese}
          </p>
        )}
      </div>

      {definitions.length > 0 && (
        <div
          className="border-t border-gray-100 pt-3 space-y-2"
          data-testid="sidepanel-definitions"
        >
          {definitions.map(def => (
            <div
              key={def.word}
              className="bg-white rounded-lg shadow-sm border border-gray-200 p-3"
              data-testid={`sidepanel-card-${def.word}`}
            >
              {/* Word, phonetic, contextual meaning, and Query Count share one
                  flex row (spec §3.9 revision) instead of stacking as
                  separate blocks -- these four are the "headline" of the
                  card, and keeping them on one line saves vertical space in
                  the narrow side panel. */}
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 mb-2">
                <span className="font-bold text-gray-800">{def.word}</span>

                {def.dictionaryStatus === 'loading' ? (
                  <span className="text-gray-400 text-xs">音标加载中...</span>
                ) : (
                  def.pronunciation && (
                    <span className="text-gray-600 text-sm">{def.pronunciation}</span>
                  )
                )}

                {def.contextStatus === 'loading' ? (
                  <span className="text-gray-400 text-sm">
                    <span className="inline-block animate-spin mr-1">⏳</span>
                    翻译中...
                  </span>
                ) : (
                  <span className="text-blue-700 font-medium text-sm">{def.contextChinese}</span>
                )}

                {def.loadCount !== undefined && (
                  <span
                    className="inline-flex items-center gap-0.5 text-xs text-gray-400 ml-auto whitespace-nowrap"
                    title={`Query Count: ${def.loadCount}`}
                  >
                    <MagnifyingGlassIcon className="h-3.5 w-3.5" aria-hidden="true" />
                    {def.loadCount}
                  </span>
                )}
              </div>

              {def.dictionaryStatus === 'loading' ? (
                <div className="text-gray-400 text-xs">词典释义加载中...</div>
              ) : (
                def.dictionaryChinese && (
                  <p className="text-gray-600 text-sm whitespace-pre-line border-t border-gray-100 pt-2 mt-2">
                    {def.dictionaryChinese}
                  </p>
                )
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function SidePanel() {
  return <SidePanelContent />
}
