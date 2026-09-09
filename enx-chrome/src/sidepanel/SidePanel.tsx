import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import '@/index.css'
import {
  ArrowPathRoundedSquareIcon,
  MagnifyingGlassIcon,
  SpeakerWaveIcon,
  XMarkIcon,
} from '@heroicons/react/20/solid'
import { initSentry } from '@/lib/sentry'
import { formatPhonetic } from '@/lib/phonetic'
import { playPronunciation } from '@/lib/pronunciation'
import { snapToWordBounds } from '@/lib/wordSegment'
import { sendMessageToBackground } from '@/services/api'
import { config } from '@/config/env'
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
// page-level word popover lookup (ADR-006), which has no sentence context to
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
  // Set when dictionaryStatus is 'error'. dictionaryErrorHttpStatus, when
  // 429, means the free daily lookup quota was exceeded (TASK-SPEC §4.2) --
  // rendered with an upgrade link instead of the generic message.
  dictionaryError?: string
  dictionaryErrorHttpStatus?: number
  contextChinese?: string
  contextError?: string
  // Set alongside contextError when contextStatus is 'error'. 402 means the
  // AI translation credit balance ran out (TASK-SPEC §4.1).
  contextErrorHttpStatus?: number
  contextStatus: FetchStatus | 'none'
}

// Billing-related HTTP statuses the backend can return from the AI
// translate and dictionary lookup endpoints (see billing/handler.go and
// dictionary/lookup.go). Kept as named constants so the render logic below
// reads as intent, not magic numbers.
const HTTP_INSUFFICIENT_CREDIT = 402
const HTTP_QUOTA_EXCEEDED = 429

// Opens enx-ui's billing page in a new browser tab (not chrome.tabs.create,
// which needs an extension-privileged context the Side Panel's rendered
// content doesn't have -- a plain link works fine here).
function UpgradeLink({ className }: { className?: string }) {
  return (
    <a
      href={`${config.frontendBaseUrl}/billing`}
      target="_blank"
      rel="noopener noreferrer"
      className={className ?? 'text-blue-600 hover:underline font-medium whitespace-nowrap'}
    >
      Subscribe / add credit
    </a>
  )
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// The original sentence renders as plain selectable text (ADR-017): no
// per-word elements, so a drag-select can run across words and clicks resolve
// by character offset. The one bit of markup is a <mark> around every
// occurrence of the word the user clicked on the page before opening the
// panel (ADR-014), so they can see which word the auto-seeded card belongs
// to. <mark> wraps the same text run, so it doesn't affect selection offsets.
const renderSentence = (sentence: string, clickedWord: string): ReactNode => {
  if (!clickedWord) return sentence
  const re = new RegExp(`\\b${escapeRegExp(clickedWord)}\\b`, 'gi')
  const parts: ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(sentence)) !== null) {
    if (m.index > last) parts.push(sentence.slice(last, m.index))
    parts.push(
      <mark
        key={m.index}
        data-clicked-word="true"
        className="bg-yellow-200 font-medium rounded px-0.5"
      >
        {m[0]}
      </mark>
    )
    last = m.index + m[0].length
  }
  if (last < sentence.length) parts.push(sentence.slice(last))
  return parts
}

// Character offset of a (node, offset) selection boundary within `root`'s
// text, computed by measuring the flattened text before it. Works regardless
// of how the text is split into nodes (e.g. by a <mark>), and is testable in
// jsdom since Range.toString() is implemented there.
const boundaryCharOffset = (root: HTMLElement, node: Node, offset: number): number => {
  const pre = document.createRange()
  pre.selectNodeContents(root)
  pre.setEnd(node, offset)
  return pre.toString().length
}

// The current selection as a [start, end) character interval within the
// rendered sentence, or null if there's no selection inside `root`.
const getSelectionCharRange = (root: HTMLElement): [number, number] | null => {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return null
  if (!sel.anchorNode || !sel.focusNode) return null
  if (!root.contains(sel.anchorNode) || !root.contains(sel.focusNode)) return null
  const r = sel.getRangeAt(0)
  const a = boundaryCharOffset(root, r.startContainer, r.startOffset)
  const b = boundaryCharOffset(root, r.endContainer, r.endOffset)
  return a <= b ? [a, b] : [b, a]
}

// The confirm affordance for an in-panel phrase selection (ADR-017 D2): a
// bare icon button pinned just below the selection -- the selected text is
// its own label. Autofocuses so it can be confirmed with Enter / dismissed
// with Esc without reaching for the mouse again; also dismissed on a
// pointerdown anywhere else or on scroll.
function PhraseConfirmButton({
  rect,
  onConfirm,
  onDismiss,
}: {
  rect: { bottom: number; left: number } | null
  onConfirm: () => void
  onDismiss: () => void
}) {
  const ref = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    ref.current?.focus()
    const dismissOnOutside = (e: Event) => {
      if (e.target instanceof Node && ref.current?.contains(e.target)) return
      onDismiss()
    }
    document.addEventListener('pointerdown', dismissOnOutside)
    window.addEventListener('scroll', onDismiss, true)
    return () => {
      document.removeEventListener('pointerdown', dismissOnOutside)
      window.removeEventListener('scroll', onDismiss, true)
    }
  }, [onDismiss])

  // rect is viewport coordinates from the selection's bounding box; clamp
  // into the panel so it can't render off-screen.
  const top = rect ? Math.max(4, rect.bottom + 4) : 4
  const left = rect ? Math.max(4, Math.min(rect.left, window.innerWidth - 40)) : 4

  return (
    <button
      ref={ref}
      type="button"
      data-testid="sidepanel-phrase-confirm"
      aria-label="Look up this phrase's meaning in context"
      onClick={onConfirm}
      onKeyDown={e => {
        if (e.key === 'Escape') onDismiss()
      }}
      style={{ position: 'fixed', top, left }}
      className="z-10 inline-flex items-center rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-blue-600 shadow-sm hover:bg-blue-100"
    >
      <MagnifyingGlassIcon className="h-4 w-4" aria-hidden="true" />
    </button>
  )
}

function SidePanelContent() {
  const [pendingContext, setPendingContext] = useState<PendingSentenceContext | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [chinese, setChinese] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [errorHttpStatus, setErrorHttpStatus] = useState<number | undefined>(undefined)
  const [definitions, setDefinitions] = useState<WordCardData[]>([])
  // Words whose (often verbose) dictionary meaning the user has expanded past
  // the default 3-line clamp. Keyed by word so it survives list reordering.
  const [expandedWords, setExpandedWords] = useState<Set<string>>(new Set())

  const toggleExpanded = useCallback((word: string) => {
    setExpandedWords(prev => {
      const next = new Set(prev)
      if (next.has(word)) next.delete(word)
      else next.add(word)
      return next
    })
  }, [])

  // Removes a single card from the running list (ADR-006 list is append-only
  // otherwise, so a long reading session accumulates noise). Purely local --
  // nothing is persisted, re-clicking the word re-adds it.
  const handleRemoveCard = useCallback((word: string) => {
    setDefinitions(prev => prev.filter(d => d.word !== word))
    setExpandedWords(prev => {
      if (!prev.has(word)) return prev
      const next = new Set(prev)
      next.delete(word)
      return next
    })
  }, [])

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

  // Mirrors a word looked up via the page's word popover into the same card
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
    setErrorHttpStatus(undefined)

    // Opened from a page word click -> one combined call returns both the
    // whole-sentence translation and that word's in-context meaning (ADR-014),
    // and the word's card is seeded immediately + highlighted in the original.
    // Opened from a drag-selected sentence (ADR-007) -> no anchor word, so
    // just the plain whole-sentence translation.
    const clickedWord = pendingContext.word?.trim() || ''
    const sentence = pendingContext.sentence

    const request: ContentMessage = clickedWord
      ? { type: 'translateSentenceWithWord', sentence, word: clickedWord }
      : { type: 'translateSentence', sentence }

    sendMessageToBackground<BackgroundResponse>(request)
      .then(response => {
        if (cancelled) return
        if (response.success && response.chinese) {
          setChinese(response.chinese)
          setStatus('loaded')
          if (clickedWord) {
            autoLookupClickedWord(clickedWord, sentence, response.wordChinese || '')
          }
        } else {
          setErrorMessage(response.error || 'Translation service unavailable')
          setErrorHttpStatus(response.status)
          setStatus('error')
        }
      })
      .catch(error => {
        if (cancelled) return
        console.error('SidePanel: sentence translation failed', error)
        setErrorMessage('Translation service unavailable')
        setErrorHttpStatus(undefined)
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
                  contextError: resolved ? undefined : response.error || 'Translation failed',
                  contextErrorHttpStatus: resolved ? undefined : response.status,
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
              ? {
                  ...d,
                  contextStatus: 'error',
                  contextChinese: undefined,
                  contextError: 'Translation failed',
                  contextErrorHttpStatus: undefined,
                }
              : d
          )
        )
      })
  }, [])

  // Fetches the dictionary half of a card (pronunciation + ECDICT Chinese +
  // Query Count) via the same getOneWord lookup the page's word popup uses,
  // and merges it into whichever card already has this word. Shared by
  // handleWordClick and the auto-lookup that runs when the panel is opened
  // from a page word click (ADR-014). NOTE: getOneWord increments the
  // server-side Query Count, so callers must only run this once per word --
  // never for a card that already has its dictionary data.
  const fetchDictionary = useCallback((word: string) => {
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
                  dictionaryError: response.success ? undefined : response.error || 'Dictionary lookup failed',
                  dictionaryErrorHttpStatus: response.success ? undefined : response.status,
                }
              : d
          )
        )
      })
      .catch(() => {
        setDefinitions(prev =>
          prev.map(d =>
            d.word === word
              ? {
                  ...d,
                  dictionaryStatus: 'error',
                  dictionaryError: 'Dictionary lookup failed',
                  dictionaryErrorHttpStatus: undefined,
                }
              : d
          )
        )
      })
  }, [])

  // Runs when the Side Panel is opened from a page word click (ADR-014): the
  // combined translateSentenceWithWord call already returned the sentence
  // translation AND (usually) this word's in-context meaning, so seed a card
  // for it right away -- the user shouldn't have to click the word again in
  // the panel. `wordChinese` empty means the model omitted it: fall back to
  // a standalone translateWordInContext call. Mirrors handleWordClick's
  // "existing card -> just reorder, don't re-fetch" rule so a word already
  // in the running list (ADR-006) isn't double-counted by getOneWord.
  const autoLookupClickedWord = useCallback(
    (rawWord: string, sentence: string, wordChinese: string) => {
      const word = rawWord.toLowerCase()
      const contextResolved = wordChinese.trim() !== ''
      const existing = definitions.find(d => d.word === word)

      if (existing) {
        setDefinitions(prev => {
          const index = prev.findIndex(d => d.word === word)
          if (index === -1) return prev
          const reordered = [prev[index], ...prev.slice(0, index), ...prev.slice(index + 1)]
          if (contextResolved && reordered[0].contextStatus !== 'loaded') {
            reordered[0] = {
              ...reordered[0],
              contextChinese: wordChinese,
              contextError: undefined,
              contextErrorHttpStatus: undefined,
              contextStatus: 'loaded',
            }
          }
          return reordered
        })
        if (!contextResolved && existing.contextStatus === 'none') {
          setDefinitions(prev =>
            prev.map(d => (d.word === word ? { ...d, contextStatus: 'loading' } : d))
          )
          fetchContextTranslation(word, sentence)
        }
        return
      }

      setDefinitions(prev => [
        {
          word,
          dictionaryStatus: 'loading',
          contextStatus: contextResolved ? 'loaded' : 'loading',
          contextChinese: contextResolved ? wordChinese : undefined,
        },
        ...prev,
      ])
      fetchDictionary(word)
      if (!contextResolved) fetchContextTranslation(word, sentence)
    },
    [definitions, fetchDictionary, fetchContextTranslation]
  )

  // Phrase-in-context lookup (ADR-008/017): a multi-word selection never has a
  // dictionary entry (ECDICT/words only has single words), so it skips
  // getOneWord entirely and only ever gets an AI translateWordInContext
  // result -- rendered as a phrase card (dictionaryStatus 'none') mixed into
  // the same definitions list as word cards, not the single-slot
  // whole-sentence area above. Re-selecting a phrase already in the list just
  // moves its card up -- no second AI call, no second charge.
  const upsertPhraseCard = useCallback(
    (phrase: string) => {
      const sentence = pendingContext?.sentence
      if (!sentence) return
      const index = definitions.findIndex(d => d.word === phrase)
      if (index !== -1) {
        setDefinitions(prev => {
          const i = prev.findIndex(d => d.word === phrase)
          if (i === -1) return prev
          return [prev[i], ...prev.slice(0, i), ...prev.slice(i + 1)]
        })
        return
      }
      setDefinitions(prev => [
        { word: phrase, dictionaryStatus: 'none', contextStatus: 'loading' },
        ...prev,
      ])
      fetchContextTranslation(phrase, sentence)
    },
    [pendingContext?.sentence, definitions, fetchContextTranslation]
  )

  // A phrase arriving via pendingContext (ADR-008: drag-selected on the web
  // page, already confirmed there) goes straight to a card -- no confirm
  // button, unlike an in-panel drag-select (ADR-017).
  useEffect(() => {
    if (pendingContext?.phrase) upsertPhraseCard(pendingContext.phrase)
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

      fetchDictionary(word)
      fetchContextTranslation(word, sentence)
    },
    [pendingContext?.sentence, definitions, fetchContextTranslation, fetchDictionary]
  )

  // Mouse selection inside the rendered original sentence (ADR-017). Resolve
  // it to a whole-word character interval, then: 1 word -> look it up (same as
  // clicking a word used to); 2+ words -> phrase, behind the confirm button.
  // Mouse only -- the plain <p> takes no keyboard selection; a keyboard user
  // reaches a word via double-click (still a mouseup) and the confirm button
  // autofocuses once it appears.
  const sentenceRef = useRef<HTMLParagraphElement>(null)
  // A 2+-word selection in the sentence is a phrase lookup, but it costs an AI
  // call (ADR-014 billing), so it waits behind a confirm button rather than
  // firing on mouseup like a single-word click does (ADR-017 D2).
  const [pendingPhrase, setPendingPhrase] = useState<{
    text: string
    rect: { bottom: number; left: number } | null
  } | null>(null)
  const clearPendingPhrase = useCallback(() => setPendingPhrase(null), [])

  // Total words in the sentence -- invariant per context, so a selection that
  // spans them all is "the whole sentence" and the top slot already has it.
  const sentenceWordCount = useMemo(() => {
    const s = pendingContext?.sentence
    return s ? snapToWordBounds(s, 0, s.length).wordCount : 0
  }, [pendingContext?.sentence])

  const handleSentenceSelection = useCallback(() => {
    clearPendingPhrase()
    const root = sentenceRef.current
    const sentence = pendingContext?.sentence
    if (!root || !sentence) return
    const range = getSelectionCharRange(root)
    if (!range) return
    const { text, wordCount } = snapToWordBounds(sentence, range[0], range[1])
    if (wordCount === 0) return
    if (wordCount === 1) {
      handleWordClick(text)
      return
    }
    // Whole sentence (or more) selected -- the top slot already translates it.
    if (wordCount >= sentenceWordCount) return
    // Already looked up -- skip the confirm step, just surface the card again.
    if (definitions.some(d => d.word === text)) {
      upsertPhraseCard(text)
      return
    }
    const sel = window.getSelection()
    // jsdom's Range has no getBoundingClientRect; guard so the handler stays
    // callable there (position is best-effort anyway).
    const r = sel?.rangeCount ? sel.getRangeAt(0) : null
    const domRect =
      r && typeof r.getBoundingClientRect === 'function' ? r.getBoundingClientRect() : null
    setPendingPhrase({
      text,
      rect: domRect ? { bottom: domRect.bottom, left: domRect.left } : null,
    })
  }, [
    pendingContext?.sentence,
    sentenceWordCount,
    handleWordClick,
    clearPendingPhrase,
    definitions,
    upsertPhraseCard,
  ])

  // The guided hint only makes sense when the panel has shown nothing at
  // all yet. Once there's a word popover (from a page lookup, ADR-006) the
  // panel has useful content to show even without a sentence context, so the
  // definitions list below must render independently of `pendingContext`.
  if (!pendingContext && definitions.length === 0) {
    return (
      <div className="p-4 text-gray-500 text-sm" data-testid="sidepanel-empty-state">
        Click any highlighted word in the page text, then click the sentence-translation icon in the popup. The full English sentence and its Chinese translation will appear here.
      </div>
    )
  }

  // The word the user clicked on the page before opening the panel (ADR-014):
  // highlight every occurrence of it in the original so they can see which
  // word the auto-seeded card belongs to. Not set for a drag-selected
  // sentence (ADR-007) or a phrase lookup (ADR-008).
  const clickedWord =
    pendingContext && !pendingContext.phrase ? (pendingContext.word || '').toLowerCase() : ''

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
          <p
            ref={sentenceRef}
            className="text-gray-900 leading-relaxed select-text"
            data-testid="sidepanel-sentence"
            onMouseUp={handleSentenceSelection}
          >
            {renderSentence(pendingContext?.sentence ?? '', clickedWord)}
          </p>
          {pendingPhrase && (
            <PhraseConfirmButton
              rect={pendingPhrase.rect}
              onConfirm={() => {
                upsertPhraseCard(pendingPhrase.text)
                clearPendingPhrase()
              }}
              onDismiss={clearPendingPhrase}
            />
          )}
        </div>
      )}

      {pendingContext && (
        <div className="border-t border-gray-100 pt-3">
          {status === 'loading' && (
            <div className="text-gray-500" data-testid="sidepanel-loading">
              <span className="inline-block animate-spin mr-2">⏳</span>
              Translating...
            </div>
          )}
          {status === 'error' && (
            <div className="text-red-600" data-testid="sidepanel-error">
              {errorHttpStatus === HTTP_INSUFFICIENT_CREDIT ? (
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span>Not enough AI translation credit</span>
                  <UpgradeLink />
                </div>
              ) : (
                errorMessage
              )}
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
        <div className="border-t border-gray-100 pt-3" data-testid="sidepanel-definitions">
          {/* List header: a running count + a way to clear the accumulated
              list, which is otherwise append-only for the panel session
              (ADR-006). */}
          <div className="flex items-center justify-between mb-2 px-0.5">
            <span className="text-xs font-medium text-gray-400">New words {definitions.length}</span>
            <button
              type="button"
              data-testid="sidepanel-clear-definitions"
              onClick={() => {
                setDefinitions([])
                setExpandedWords(new Set())
              }}
              className="text-xs text-gray-400 hover:text-red-500"
            >
              Clear
            </button>
          </div>

          {/* One bordered list with hairline dividers instead of a stack of
              individually-bordered cards (spec §3.9 revision): the panel is
              narrow and white-on-white cards barely read against the
              background -- a single frame with divide-y is denser and calmer. */}
          <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 overflow-hidden">
            {definitions.map(def => {
              const phonetic = formatPhonetic(def.pronunciation)
              const expanded = expandedWords.has(def.word)
              const dictLong =
                !!def.dictionaryChinese &&
                (def.dictionaryChinese.length > 40 || def.dictionaryChinese.includes('\n'))
              return (
                <div
                  key={def.word}
                  className="group relative px-3 py-2.5 hover:bg-gray-50"
                  data-testid={`sidepanel-card-${def.word}`}
                >
                  {/* Headline: word + phonetic + play + Query Count on one
                      row. The contextual meaning is NOT here anymore -- it
                      moved down into the meaning block with a 本句 tag so it
                      reads as "this word, in this sentence" rather than
                      competing with the phonetic for the same line. */}
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 pr-5">
                    <span className="font-semibold text-gray-800">{def.word}</span>

                    {def.dictionaryStatus === 'loading' ? (
                      <span className="text-gray-400 text-xs">Loading phonetics...</span>
                    ) : (
                      phonetic && (
                        <span className="inline-flex items-center gap-1">
                          <span className="text-gray-500 text-xs">{phonetic}</span>
                          <button
                            data-testid={`sidepanel-play-pronunciation-${def.word}`}
                            type="button"
                            onClick={() => playPronunciation(def.word)}
                            className="text-gray-400 hover:text-blue-500 leading-none p-1 -m-1"
                            title="Play pronunciation"
                          >
                            <SpeakerWaveIcon className="h-3.5 w-3.5 block" aria-hidden="true" />
                          </button>
                        </span>
                      )
                    )}

                    {def.loadCount !== undefined && (
                      <span
                        className="inline-flex items-center gap-0.5 text-xs text-gray-300 ml-auto whitespace-nowrap"
                        title={`Query Count: ${def.loadCount}`}
                      >
                        <ArrowPathRoundedSquareIcon
                          className="h-3.5 w-3.5"
                          aria-hidden="true"
                        />
                        {def.loadCount}
                      </span>
                    )}
                  </div>

                  {/* Dismiss this card -- the list otherwise only grows. */}
                  <button
                    type="button"
                    data-testid={`sidepanel-remove-${def.word}`}
                    onClick={() => handleRemoveCard(def.word)}
                    className="absolute top-1.5 right-1.5 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                    title="Remove"
                    aria-label={`Remove ${def.word}`}
                  >
                    <XMarkIcon className="h-4 w-4" aria-hidden="true" />
                  </button>

                  {/* Kept off the headline row: an error (e.g. session expiry)
                      read as a real translation there. Its own row + retry
                      button makes it obviously an error and recoverable. */}
                  {def.contextStatus === 'error' && (
                    <div
                      className="flex items-center justify-between gap-2 text-red-600 text-xs bg-red-50 rounded px-2 py-1 mt-2"
                      data-testid={`sidepanel-context-error-${def.word}`}
                    >
                      <span className="flex-1">
                        {def.contextErrorHttpStatus === HTTP_INSUFFICIENT_CREDIT
                          ? 'Not enough AI translation credit'
                          : def.contextError}
                      </span>
                      {def.contextErrorHttpStatus === HTTP_INSUFFICIENT_CREDIT && (
                        <UpgradeLink className="text-red-600 hover:text-red-800 font-medium whitespace-nowrap underline" />
                      )}
                      <button
                        type="button"
                        data-testid={`sidepanel-retry-context-${def.word}`}
                        onClick={() => handleRetryContextTranslation(def.word)}
                        className="text-red-600 hover:text-red-800 font-medium whitespace-nowrap"
                        title="Retry"
                      >
                        Retry
                      </button>
                    </div>
                  )}

                  {/* Dictionary half's own error row -- 429 means the free
                      daily lookup quota (TASK-SPEC §4.2) was hit, distinct
                      from a generic lookup failure. */}
                  {def.dictionaryStatus === 'error' && (
                    <div
                      className="flex items-center justify-between gap-2 text-red-600 text-xs bg-red-50 rounded px-2 py-1 mt-2"
                      data-testid={`sidepanel-dictionary-error-${def.word}`}
                    >
                      <span className="flex-1">
                        {def.dictionaryErrorHttpStatus === HTTP_QUOTA_EXCEEDED
                          ? "You've used up today's free lookups"
                          : def.dictionaryError}
                      </span>
                      {def.dictionaryErrorHttpStatus === HTTP_QUOTA_EXCEEDED && (
                        <UpgradeLink className="text-red-600 hover:text-red-800 font-medium whitespace-nowrap underline" />
                      )}
                    </div>
                  )}

                  {/* Meaning block: the AI in-sentence gloss (tagged 本句,
                      blue) sits above the generic dictionary meaning (gray,
                      clamped to 3 lines -- ECDICT dumps can be very long). */}
                  {(def.contextStatus === 'loading' ||
                    def.contextStatus === 'loaded' ||
                    def.dictionaryStatus === 'loading' ||
                    def.dictionaryChinese) && (
                    <div className="mt-1.5 space-y-1">
                      {def.contextStatus === 'loading' && (
                        <p className="text-gray-400 text-sm">
                          <span className="inline-block animate-spin mr-1">⏳</span>
                          Translating...
                        </p>
                      )}
                      {def.contextStatus === 'loaded' && (
                        <p className="text-sm text-blue-700">
                          <span className="mr-1.5 rounded bg-blue-50 px-1 py-0.5 text-[10px] font-medium text-blue-500">
                            in context
                          </span>
                          <span className="font-medium">{def.contextChinese}</span>
                        </p>
                      )}

                      {def.dictionaryStatus === 'loading' ? (
                        <p className="text-gray-400 text-xs">Loading dictionary definition...</p>
                      ) : (
                        def.dictionaryChinese && (
                          <div>
                            <p
                              className={`text-gray-500 text-sm whitespace-pre-line ${
                                expanded ? '' : 'line-clamp-3'
                              }`}
                            >
                              {def.dictionaryChinese}
                            </p>
                            {dictLong && (
                              <button
                                type="button"
                                data-testid={`sidepanel-toggle-meaning-${def.word}`}
                                onClick={() => toggleExpanded(def.word)}
                                className="text-xs text-gray-400 hover:text-blue-500 mt-0.5"
                              >
                                {expanded ? 'Collapse' : 'Expand'}
                              </button>
                            )}
                          </div>
                        )
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export default function SidePanel() {
  return <SidePanelContent />
}
