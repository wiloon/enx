import { useCallback, useEffect, useState } from 'react'
import '@/index.css'
import { MagnifyingGlassIcon } from '@heroicons/react/20/solid'
import { initSentry } from '@/lib/sentry'
import { playPronunciation } from '@/lib/pronunciation'
import { sendMessageToBackground } from '@/services/api'
import {
  BackgroundResponse,
  ContentMessage,
  LATEST_PAGE_WORD_STORAGE_KEY,
  LatestPageWordLookup,
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
// 'none' means "not applicable". On contextStatus: cards created from a
// page-level WordPopup lookup (ADR-006), which has no sentence context to
// translate against and so must never show the "翻译中..."/context text UI
// at all. On dictionaryStatus: phrase cards (ADR-008) -- a 2-5 word
// selection never has an ECDICT/words entry, so they skip the dictionary
// half entirely and only ever populate the context* fields.
interface WordCardData {
  word: string
  pronunciation?: string
  loadCount?: number
  dictionaryChinese?: string
  dictionaryStatus: FetchStatus | 'none'
  contextChinese?: string
  contextError?: string
  contextStatus: FetchStatus | 'none'
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

  // Keep listening for a new sentence context: if the panel is already open
  // and the user clicks "整句翻译" on another word on the page, this fires
  // with the new context and the panel refreshes in place -- no need to
  // re-trigger sidePanel.open() (spec §3.3/§4.6). Initial mount-time read is
  // handled below, combined with LATEST_PAGE_WORD_STORAGE_KEY, so whichever
  // of the two actually happened more recently wins (ADR-006).
  useEffect(() => {
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

  // Mirrors a word looked up via the page's WordPopup into the same card
  // list used for sentence-word clicks (ADR-006). Merges the already-fetched
  // WordData directly -- no re-fetch -- and clears the sentence
  // original/translation display, since the incoming word may not belong to
  // whatever sentence is currently shown. Deliberately does NOT touch
  // `definitions` wholesale (only prepends/reorders one card), so it must
  // never route through setPendingContext with a fresh createdAt -- that
  // would re-trigger the sentence-translation effect below and wipe the list
  // this effect is trying to add to.
  const mergePageWordLookup = useCallback((lookup: LatestPageWordLookup) => {
    const word = lookup.word.toLowerCase()

    setPendingContext(null)
    setChinese('')
    setErrorMessage('')
    setStatus('idle')

    setDefinitions(prev => {
      const index = prev.findIndex(d => d.word === word)
      if (index !== -1) {
        return [prev[index], ...prev.slice(0, index), ...prev.slice(index + 1)]
      }
      const card: WordCardData = {
        word,
        pronunciation: lookup.ecp.Pronunciation,
        loadCount: lookup.ecp.LoadCount,
        dictionaryChinese: lookup.ecp.Chinese,
        dictionaryStatus: 'loaded',
        contextStatus: 'none',
      }
      return [card, ...prev]
    })
  }, [])

  useEffect(() => {
    const listener = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string
    ) => {
      if (areaName !== 'session') return
      const change = changes[LATEST_PAGE_WORD_STORAGE_KEY]
      if (change?.newValue) {
        mergePageWordLookup(change.newValue as LatestPageWordLookup)
      }
    }
    chrome.storage.onChanged.addListener(listener)
    return () => chrome.storage.onChanged.removeListener(listener)
  }, [mergePageWordLookup])

  // One-time mount read of both storage keys together: whichever actually
  // happened more recently (by createdAt) wins, since the two independent
  // `.get()` calls above would otherwise race and let whichever Promise
  // settles last clobber the other regardless of real chronological order.
  useEffect(() => {
    Promise.all([
      chrome.storage.session.get(PENDING_SENTENCE_STORAGE_KEY),
      chrome.storage.session.get(LATEST_PAGE_WORD_STORAGE_KEY),
    ]).then(([sentenceResult, wordResult]) => {
      const sentence = sentenceResult[PENDING_SENTENCE_STORAGE_KEY] as
        | PendingSentenceContext
        | undefined
      const word = wordResult[LATEST_PAGE_WORD_STORAGE_KEY] as LatestPageWordLookup | undefined

      if (word && (!sentence || word.createdAt > sentence.createdAt)) {
        mergePageWordLookup(word)
      } else if (sentence) {
        setPendingContext(sentence)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Re-translate whenever a new sentence context arrives. Keyed on
  // createdAt so re-clicking the same sentence still re-triggers a fetch.
  // Deliberately does not reset `definitions`: the card list is a running
  // list for the whole panel session (ADR-006), not scoped to one sentence,
  // so showing a new sentence's translation must not discard word cards
  // already on screen -- whether they came from this sentence, an earlier
  // one, or a page-level lookup.
  useEffect(() => {
    // A phrase-in-context context (ADR-008) renders as a phrase card in the
    // definitions list instead (see the effect below) -- the top slot stays
    // reserved for genuine whole-sentence translation.
    if (!pendingContext || pendingContext.phrase) return

    let cancelled = false
    setStatus('loading')
    setErrorMessage('')

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

  // Shared by both branches of handleWordClick below: fetches the word's
  // meaning in the current sentence and merges it into whichever card
  // already has this word, without touching the dictionary half.
  const fetchContextTranslation = useCallback((word: string, sentence: string) => {
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
                  contextChinese: resolved ? response.chinese : undefined,
                  contextError: resolved ? undefined : response.error || '翻译失败',
                  contextStatus: resolved ? 'loaded' : 'error',
                }
              : d
          )
        )
      })
      .catch(() => {
        setDefinitions(prev =>
          prev.map(d =>
            d.word === word
              ? { ...d, contextStatus: 'error', contextChinese: undefined, contextError: '翻译失败' }
              : d
          )
        )
      })
  }, [])

  // Phrase-in-context lookup (ADR-008): a 2-5 word selection inside a larger
  // sentence never has a dictionary entry (ECDICT/words only has single
  // words), so it skips getOneWord entirely and only ever gets an AI
  // translateWordInContext result -- rendered as a phrase card (dictionaryStatus
  // 'none') mixed into the same definitions list as word cards, not the
  // single-slot whole-sentence area above.
  useEffect(() => {
    if (!pendingContext?.phrase) return

    const phrase = pendingContext.phrase
    const sentence = pendingContext.sentence

    setDefinitions(prev => [
      { word: phrase, dictionaryStatus: 'none', contextStatus: 'loading' },
      ...prev,
    ])
    fetchContextTranslation(phrase, sentence)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingContext?.createdAt])

  // Lets a card stuck in contextStatus 'error' (e.g. session expiry) recover
  // without a full page reload -- handleWordClick only re-fetches for
  // contextStatus 'none', so an error needs its own explicit retry path.
  const handleRetryContextTranslation = useCallback(
    (word: string) => {
      const sentence = pendingContext?.sentence
      if (!sentence) return
      setDefinitions(prev =>
        prev.map(d =>
          d.word === word ? { ...d, contextStatus: 'loading', contextError: undefined } : d
        )
      )
      fetchContextTranslation(word, sentence)
    },
    [pendingContext?.sentence, fetchContextTranslation]
  )

  // Word click in the Side Panel fires two independent requests (spec
  // §3.7/§3.8/§3.9): getOneWord (same lookup the page's word popup uses --
  // pronunciation + dictionary Chinese + query count) and
  // translateWordInContext (AI translation of the word's meaning in this
  // specific sentence). Each updates only its own half of the card as soon
  // as it resolves -- the card renders progressively rather than waiting for
  // both. Re-clicking a word that already has a context translation just
  // moves its card to the front instead of re-fetching (spec §3.9). But a
  // card with contextStatus 'none' (added from a page-level lookup,
  // ADR-006) has never had its in-sentence meaning fetched at all -- clicking
  // it here now backfills just that half, reusing the dictionary data
  // already on the card instead of re-fetching getOneWord too.
  const handleWordClick = useCallback(
    (rawWord: string) => {
      const word = rawWord.toLowerCase()
      const sentence = pendingContext?.sentence
      if (!sentence) return

      const existing = definitions.find(d => d.word === word)
      if (existing) {
        setDefinitions(prev => {
          const index = prev.findIndex(d => d.word === word)
          if (index === -1) return prev
          return [prev[index], ...prev.slice(0, index), ...prev.slice(index + 1)]
        })

        if (existing.contextStatus === 'none') {
          setDefinitions(prev =>
            prev.map(d => (d.word === word ? { ...d, contextStatus: 'loading' } : d))
          )
          fetchContextTranslation(word, sentence)
        }
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

      fetchContextTranslation(word, sentence)
    },
    [pendingContext?.sentence, definitions, fetchContextTranslation]
  )

  // The guided hint only makes sense when the panel has shown nothing at
  // all yet. Once there's a word card (from a page lookup, ADR-006) the
  // panel has useful content to show even without a sentence context, so the
  // definitions list below must render independently of `pendingContext`.
  if (!pendingContext && definitions.length === 0) {
    return (
      <div className="p-4 text-gray-500 text-sm" data-testid="sidepanel-empty-state">
        点击网页正文中任意已高亮的单词，然后点击弹窗里的「🔤 整句翻译」按钮，整句英文和中文翻译会显示在这里。
      </div>
    )
  }

  const tokens = pendingContext ? tokenizeSentence(pendingContext.sentence) : []

  return (
    <div className="p-4 space-y-4 text-sm">
      {pendingContext && (
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
      )}

      {pendingContext && (
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
      )}

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
                    <span className="inline-flex items-center gap-1">
                      <span className="text-gray-600 text-sm">{def.pronunciation}</span>
                      <button
                        data-testid={`sidepanel-play-pronunciation-${def.word}`}
                        type="button"
                        onClick={() => playPronunciation(def.word)}
                        className="text-gray-400 hover:text-blue-500"
                        title="Play pronunciation"
                      >
                        🔊
                      </button>
                    </span>
                  )
                )}

                {def.contextStatus === 'loading' && (
                  <span className="text-gray-400 text-sm">
                    <span className="inline-block animate-spin mr-1">⏳</span>
                    翻译中...
                  </span>
                )}
                {def.contextStatus === 'loaded' && (
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

              {/* Kept off the headline row: an error (e.g. session expiry)
                  read as a real translation there. Its own row + retry
                  button makes it obviously an error and recoverable. */}
              {def.contextStatus === 'error' && (
                <div
                  className="flex items-center justify-between gap-2 text-red-600 text-xs bg-red-50 rounded px-2 py-1 mb-2"
                  data-testid={`sidepanel-context-error-${def.word}`}
                >
                  <span className="flex-1">{def.contextError}</span>
                  <button
                    type="button"
                    data-testid={`sidepanel-retry-context-${def.word}`}
                    onClick={() => handleRetryContextTranslation(def.word)}
                    className="text-red-600 hover:text-red-800 font-medium whitespace-nowrap"
                    title="Retry"
                  >
                    重试
                  </button>
                </div>
              )}

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
