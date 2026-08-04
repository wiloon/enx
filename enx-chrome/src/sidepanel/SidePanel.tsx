import { useCallback, useEffect, useState } from 'react'
import '@/index.css'
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

interface WordDefinition {
  word: string
  chinese: string
  pronunciation: string
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
  const [definitions, setDefinitions] = useState<WordDefinition[]>([])

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

  // Word click in the Side Panel translates the word using the current
  // sentence as context (spec §3.7/§3.8) instead of reusing the
  // context-free ECDICT lookup the page's word popup uses. Pronunciation is
  // still cheap/context-independent, so it's fetched from the existing
  // getOneWord/ECDICT path in parallel -- one request failing doesn't block
  // the other from showing.
  const handleWordClick = useCallback(
    async (rawWord: string) => {
      const word = rawWord.toLowerCase()
      const sentence = pendingContext?.sentence
      if (!sentence) return

      const [contextResult, pronunciationResult] = await Promise.allSettled([
        sendMessageToBackground<BackgroundResponse>({
          type: 'translateWordInContext',
          word,
          sentence,
        } satisfies ContentMessage),
        sendMessageToBackground<BackgroundResponse>({
          type: 'getOneWord',
          word,
        } satisfies ContentMessage),
      ])

      const chinese =
        contextResult.status === 'fulfilled' &&
        contextResult.value.success &&
        contextResult.value.chinese
          ? contextResult.value.chinese
          : contextResult.status === 'fulfilled'
            ? contextResult.value.error || '翻译失败'
            : '翻译失败'

      const pronunciation =
        pronunciationResult.status === 'fulfilled' &&
        pronunciationResult.value.success &&
        pronunciationResult.value.ecp
          ? pronunciationResult.value.ecp.Pronunciation || ''
          : ''

      setDefinitions(prev => [...prev, { word, chinese, pronunciation }])
    },
    [pendingContext?.sentence]
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
          {definitions.map((def, i) => (
            <div key={i} className="text-gray-700">
              <span className="font-medium">{def.word}</span>
              {def.pronunciation && (
                <span className="text-gray-500 ml-1">{def.pronunciation}</span>
              )}
              <span className="ml-2">{def.chinese}</span>
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
