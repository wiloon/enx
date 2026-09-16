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

// Word click in the Side Panel renders as a card (spec §3.9): dictionary
// lookup (getOneWord) and AI contextual translation (translateWordInContext)
// each track their own status -- the card renders progressively, showing
// whichever half resolves first. 'none' means "not applicable". On
// contextStatus: cards created from a page-level word popover lookup
// (ADR-006) have no sentence context to translate against and so must never
// show the "翻译中..."/context text UI at all. On dictionaryStatus: phrase
// cards (ADR-008) -- a 2-5 word selection never has an ECDICT/words entry, so
// they skip the dictionary half entirely and only ever populate context*.
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
  // One short clause explaining why contextChinese differs from
  // dictionaryChinese, when the model judged the gap worth flagging. Empty
  // or unset means no explanation was offered (ordinary sense, or the
  // fallback translateWordInContext call was used instead).
  contextWhy?: string
  contextError?: string
  // Set alongside contextError when contextStatus is 'error'. 402 means the
  // AI translation credit balance ran out (TASK-SPEC §4.1).
  contextErrorHttpStatus?: number
  contextStatus: FetchStatus | 'none'
  // The sentence text this card's context translation was fetched against,
  // set only for a TOP-LEVEL card (ADR-023: a main-page phrase lookup,
  // ADR-008, has no owning SentenceEntry to recall it from). A card nested
  // inside a SentenceEntry's `words` instead reads its owning entry's
  // `sentence` at retry time, so it's left unset there.
  contextSentence?: string
}

// A card in the Side Panel's unified history list (ADR-023): either a
// standalone word/phrase card (top-level, from a page click or a main-page
// phrase drag-select -- ADR-006/008) or a sentence translation, which owns
// its own nested `words` list for anything looked up by selecting text
// inside THIS sentence's own rendered original (ADR-017). Nesting only
// happens for a selection made inside the sentence's own <p> -- a main-page
// lookup never tries to match itself to a history sentence (ADR-023
// Decision B2), so the two origins stay structurally separate.
interface SentenceEntry {
  kind: 'sentence'
  id: string
  sourceUrl?: string
  sentence: string
  // The word the user clicked on the page before opening the panel
  // (ADR-014), highlighted via <mark> in the rendered original. Empty for a
  // drag-selected sentence (ADR-007) -- no anchor word.
  clickedWord: string
  status: Status
  chinese: string
  errorMessage: string
  errorHttpStatus?: number
  words: WordCardData[]
}

type PanelEntry = ({ kind: 'word' } & WordCardData) | SentenceEntry

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

// A sentence's original renders as plain selectable text (ADR-017): no
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
        className="bg-yellow-200 font-medium rounded-sm px-0.5"
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

// -- Pure helpers over PanelEntry[] (ADR-023) --------------------------------
// `sentenceId === undefined` targets the top-level word/phrase entries;
// `sentenceId` set targets that SentenceEntry's own nested `words`. Keeping
// these as pure functions (rather than inlined setState updaters) is what
// lets every card-mutating callback below stay a one-liner regardless of
// which scope it's writing into.

const findCard = (
  entries: PanelEntry[],
  sentenceId: string | undefined,
  word: string
): WordCardData | undefined => {
  if (sentenceId === undefined) {
    return entries.find((e): e is { kind: 'word' } & WordCardData => e.kind === 'word' && e.word === word)
  }
  const sentence = entries.find(
    (e): e is SentenceEntry => e.kind === 'sentence' && e.id === sentenceId
  )
  return sentence?.words.find(w => w.word === word)
}

// Reorders the card to the front if `word` already exists at this scope
// (reusing its existing data, never re-fetching); otherwise inserts a new
// card built by `makeCard()` at the front.
const reorderOrInsertCard = (
  entries: PanelEntry[],
  sentenceId: string | undefined,
  word: string,
  makeCard: () => WordCardData
): PanelEntry[] => {
  if (sentenceId === undefined) {
    const index = entries.findIndex(e => e.kind === 'word' && e.word === word)
    if (index !== -1) return [entries[index], ...entries.slice(0, index), ...entries.slice(index + 1)]
    return [{ kind: 'word', ...makeCard() }, ...entries]
  }
  return entries.map(e => {
    if (e.kind !== 'sentence' || e.id !== sentenceId) return e
    const index = e.words.findIndex(w => w.word === word)
    if (index !== -1) {
      return { ...e, words: [e.words[index], ...e.words.slice(0, index), ...e.words.slice(index + 1)] }
    }
    return { ...e, words: [makeCard(), ...e.words] }
  })
}

const patchCard = (
  entries: PanelEntry[],
  sentenceId: string | undefined,
  word: string,
  patch: Partial<WordCardData>
): PanelEntry[] => {
  if (sentenceId === undefined) {
    return entries.map(e => (e.kind === 'word' && e.word === word ? { ...e, ...patch } : e))
  }
  return entries.map(e =>
    e.kind === 'sentence' && e.id === sentenceId
      ? { ...e, words: e.words.map(w => (w.word === word ? { ...w, ...patch } : w)) }
      : e
  )
}

const removeCard = (
  entries: PanelEntry[],
  sentenceId: string | undefined,
  word: string
): PanelEntry[] => {
  if (sentenceId === undefined) {
    return entries.filter(e => !(e.kind === 'word' && e.word === word))
  }
  return entries.map(e =>
    e.kind === 'sentence' && e.id === sentenceId ? { ...e, words: e.words.filter(w => w.word !== word) } : e
  )
}

// -----------------------------------------------------------------------

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
      className="z-10 inline-flex items-center rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-blue-600 shadow-xs hover:bg-blue-100"
    >
      <MagnifyingGlassIcon className="h-4 w-4" aria-hidden="true" />
    </button>
  )
}

// One word/phrase card: headline (word + phonetic + play + Query Count),
// dismiss button, error rows, and the meaning block (AI in-context gloss over
// the generic dictionary meaning). Shared by the top-level list and every
// SentenceEntry's nested `words` list (ADR-023) -- rendering doesn't care
// which scope a card lives in, only the callbacks passed in do.
function WordCard({
  card,
  expanded,
  onToggleExpand,
  onRemove,
  onRetryContext,
}: {
  card: WordCardData
  expanded: boolean
  onToggleExpand: () => void
  onRemove: () => void
  onRetryContext: () => void
}) {
  const phonetic = formatPhonetic(card.pronunciation)
  const dictLong =
    !!card.dictionaryChinese && (card.dictionaryChinese.length > 40 || card.dictionaryChinese.includes('\n'))

  return (
    <div
      className="group relative rounded-lg border border-gray-200 bg-white px-3 py-2.5 hover:bg-gray-50"
      data-testid={`sidepanel-card-${card.word}`}
    >
      {/* Headline: word + phonetic + play + Query Count on one row. The
          contextual meaning is NOT here -- it's in the meaning block below
          with a 本句 tag so it reads as "this word, in this sentence" rather
          than competing with the phonetic for the same line. */}
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 pr-5">
        <span className="font-semibold text-gray-800">{card.word}</span>

        {card.dictionaryStatus === 'loading' ? (
          <span className="text-gray-400 text-xs">Loading phonetics...</span>
        ) : (
          phonetic && (
            <span className="inline-flex items-center gap-1">
              <span className="text-gray-500 text-xs">{phonetic}</span>
              <button
                data-testid={`sidepanel-play-pronunciation-${card.word}`}
                type="button"
                onClick={() => playPronunciation(card.word)}
                className="text-gray-400 hover:text-blue-500 leading-none p-1 -m-1"
                title="Play pronunciation"
              >
                <SpeakerWaveIcon className="h-3.5 w-3.5 block" aria-hidden="true" />
              </button>
            </span>
          )
        )}

        {card.loadCount !== undefined && (
          <span
            className="inline-flex items-center gap-0.5 text-xs text-gray-300 ml-auto whitespace-nowrap"
            title={`Query Count: ${card.loadCount}`}
          >
            <ArrowPathRoundedSquareIcon className="h-3.5 w-3.5" aria-hidden="true" />
            {card.loadCount}
          </span>
        )}
      </div>

      {/* Dismiss this card -- the list otherwise only grows. */}
      <button
        type="button"
        data-testid={`sidepanel-remove-${card.word}`}
        onClick={onRemove}
        className="absolute top-1.5 right-1.5 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
        title="Remove"
        aria-label={`Remove ${card.word}`}
      >
        <XMarkIcon className="h-4 w-4" aria-hidden="true" />
      </button>

      {/* Kept off the headline row: an error (e.g. session expiry) read as a
          real translation there. Its own row + retry button makes it
          obviously an error and recoverable. */}
      {card.contextStatus === 'error' && (
        <div
          className="flex items-center justify-between gap-2 text-red-600 text-xs bg-red-50 rounded-sm px-2 py-1 mt-2"
          data-testid={`sidepanel-context-error-${card.word}`}
        >
          <span className="flex-1">
            {card.contextErrorHttpStatus === HTTP_INSUFFICIENT_CREDIT
              ? 'Not enough AI translation credit'
              : card.contextError}
          </span>
          {card.contextErrorHttpStatus === HTTP_INSUFFICIENT_CREDIT && (
            <UpgradeLink className="text-red-600 hover:text-red-800 font-medium whitespace-nowrap underline" />
          )}
          <button
            type="button"
            data-testid={`sidepanel-retry-context-${card.word}`}
            onClick={onRetryContext}
            className="text-red-600 hover:text-red-800 font-medium whitespace-nowrap"
            title="Retry"
          >
            Retry
          </button>
        </div>
      )}

      {/* Dictionary half's own error row -- 429 means the free daily lookup
          quota (TASK-SPEC §4.2) was hit, distinct from a generic failure. */}
      {card.dictionaryStatus === 'error' && (
        <div
          className="flex items-center justify-between gap-2 text-red-600 text-xs bg-red-50 rounded-sm px-2 py-1 mt-2"
          data-testid={`sidepanel-dictionary-error-${card.word}`}
        >
          <span className="flex-1">
            {card.dictionaryErrorHttpStatus === HTTP_QUOTA_EXCEEDED
              ? "You've used up today's free lookups"
              : card.dictionaryError}
          </span>
          {card.dictionaryErrorHttpStatus === HTTP_QUOTA_EXCEEDED && (
            <UpgradeLink className="text-red-600 hover:text-red-800 font-medium whitespace-nowrap underline" />
          )}
        </div>
      )}

      {/* Meaning block: the AI in-sentence gloss (tagged 本句, blue) sits
          above the generic dictionary meaning (gray, clamped to 3 lines --
          ECDICT dumps can be very long). */}
      {(card.contextStatus === 'loading' ||
        card.contextStatus === 'loaded' ||
        card.dictionaryStatus === 'loading' ||
        card.dictionaryChinese) && (
        <div className="mt-1.5 space-y-1">
          {card.contextStatus === 'loading' && (
            <p className="text-gray-400 text-sm">
              <span className="inline-block animate-spin mr-1">⏳</span>
              Translating...
            </p>
          )}
          {card.contextStatus === 'loaded' && (
            <p className="text-sm text-blue-700">
              <span className="mr-1.5 rounded-sm bg-blue-50 px-1 py-0.5 text-[10px] font-medium text-blue-500">
                in context
              </span>
              <span className="font-medium">{card.contextChinese}</span>
            </p>
          )}
          {card.contextStatus === 'loaded' && card.contextWhy && (
            <p
              data-testid={`sidepanel-context-why-${card.word}`}
              className="text-xs italic text-gray-400"
            >
              {card.contextWhy}
            </p>
          )}

          {card.dictionaryStatus === 'loading' ? (
            <p className="text-gray-400 text-xs">Loading dictionary definition...</p>
          ) : (
            card.dictionaryChinese && (
              <div>
                <p
                  className={`text-gray-500 text-sm whitespace-pre-line ${expanded ? '' : 'line-clamp-3'}`}
                >
                  {card.dictionaryChinese}
                </p>
                {dictLong && (
                  <button
                    type="button"
                    data-testid={`sidepanel-toggle-meaning-${card.word}`}
                    onClick={onToggleExpand}
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
}

// One sentence's original + translation + its own nested word/phrase history
// (ADR-023). Owns the mouse-selection handling for its own rendered original
// (ADR-017) -- each SentenceEntry gets its own <p> and its own selection
// state, so selecting inside one historical sentence can never affect
// another's, or the panel's overall entry order.
function SentenceBlock({
  entry,
  expandedWords,
  onToggleExpand,
  onWordClick,
  onPhraseConfirm,
  onRemoveWord,
  onRetryContext,
}: {
  entry: SentenceEntry
  expandedWords: Set<string>
  onToggleExpand: (word: string) => void
  onWordClick: (sentenceId: string, sentence: string, word: string) => void
  onPhraseConfirm: (sentenceId: string, sentence: string, phrase: string) => void
  onRemoveWord: (sentenceId: string, word: string) => void
  onRetryContext: (sentenceId: string, word: string) => void
}) {
  const sentenceRef = useRef<HTMLParagraphElement>(null)
  // A 2+-word selection in the sentence is a phrase lookup, but it costs an AI
  // call (ADR-014 billing), so it waits behind a confirm button rather than
  // firing on mouseup like a single-word click does (ADR-017 D2).
  const [pendingPhrase, setPendingPhrase] = useState<{
    text: string
    rect: { bottom: number; left: number } | null
  } | null>(null)
  const clearPendingPhrase = useCallback(() => setPendingPhrase(null), [])

  // Total words in the sentence -- invariant per entry, so a selection that
  // spans them all is "the whole sentence" and the top status area already
  // shows it.
  const sentenceWordCount = useMemo(
    () => snapToWordBounds(entry.sentence, 0, entry.sentence.length).wordCount,
    [entry.sentence]
  )

  // Mouse selection inside this sentence's rendered original (ADR-017).
  // Resolves to a whole-word character interval, then: 1 word -> look it up
  // (nested into THIS entry's own `words`, never the top-level list or any
  // other sentence -- ADR-023 Decision B2/C2); 2+ words -> phrase, behind the
  // confirm button. Mouse only -- the plain <p> takes no keyboard selection.
  const handleSentenceSelection = useCallback(() => {
    clearPendingPhrase()
    const root = sentenceRef.current
    if (!root) return
    const range = getSelectionCharRange(root)
    if (!range) return
    const { text, wordCount } = snapToWordBounds(entry.sentence, range[0], range[1])
    if (wordCount === 0) return
    if (wordCount === 1) {
      onWordClick(entry.id, entry.sentence, text)
      return
    }
    // Whole sentence (or more) selected -- the status area already covers it.
    if (wordCount >= sentenceWordCount) return
    // Already looked up in this sentence -- skip the confirm step, resurface it.
    if (entry.words.some(w => w.word === text)) {
      onPhraseConfirm(entry.id, entry.sentence, text)
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
  }, [entry, sentenceWordCount, onWordClick, onPhraseConfirm, clearPendingPhrase])

  return (
    <div
      data-testid={`sidepanel-sentence-entry-${entry.id}`}
      className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-3"
    >
      <div>
        {entry.sourceUrl && (
          <div
            className="text-xs text-gray-400 mb-1 truncate"
            title={entry.sourceUrl}
            data-testid="sidepanel-source-url"
          >
            {entry.sourceUrl}
          </div>
        )}
        <p
          ref={sentenceRef}
          className="text-gray-900 leading-relaxed select-text"
          data-testid="sidepanel-sentence"
          onMouseUp={handleSentenceSelection}
        >
          {renderSentence(entry.sentence, entry.clickedWord)}
        </p>
        {pendingPhrase && (
          <PhraseConfirmButton
            rect={pendingPhrase.rect}
            onConfirm={() => {
              onPhraseConfirm(entry.id, entry.sentence, pendingPhrase.text)
              clearPendingPhrase()
            }}
            onDismiss={clearPendingPhrase}
          />
        )}
      </div>

      <div className="border-t border-gray-100 pt-3">
        {entry.status === 'loading' && (
          <div className="text-gray-500" data-testid="sidepanel-loading">
            <span className="inline-block animate-spin mr-2">⏳</span>
            Translating...
          </div>
        )}
        {entry.status === 'error' && (
          <div className="text-red-600" data-testid="sidepanel-error">
            {entry.errorHttpStatus === HTTP_INSUFFICIENT_CREDIT ? (
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span>Not enough AI translation credit</span>
                <UpgradeLink />
              </div>
            ) : (
              entry.errorMessage
            )}
          </div>
        )}
        {entry.status === 'loaded' && (
          <p className="text-gray-800" data-testid="sidepanel-chinese">
            {entry.chinese}
          </p>
        )}
      </div>

      {entry.words.length > 0 && (
        <div data-testid="sidepanel-sentence-words" className="space-y-2">
          {entry.words.map(card => (
            <WordCard
              key={card.word}
              card={card}
              expanded={expandedWords.has(card.word)}
              onToggleExpand={() => onToggleExpand(card.word)}
              onRemove={() => onRemoveWord(entry.id, card.word)}
              onRetryContext={() => onRetryContext(entry.id, card.word)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function SidePanelContent() {
  // The unified, newest-on-top history list (ADR-023): word/phrase cards
  // that arrived without an owning sentence (page clicks, ADR-006; main-page
  // phrase drag-select, ADR-008) sit at the top level; a sentence
  // translation is its own entry that owns a nested `words` list for
  // anything looked up inside ITS OWN rendered original (ADR-017). A
  // reorder only ever happens at the scope the selection came from -- a
  // main-page click never searches history sentences for a match to nest
  // into (Decision B2), so scoping never needs cross-referencing.
  const [entries, setEntries] = useState<PanelEntry[]>([])
  // Mirrors `entries` for callbacks reached from inside a long-lived effect
  // closure (the sentence-creation effect below only depends on
  // `pendingContext?.createdAt`, so its `.then()` captures whatever
  // `entries` was AT THAT RENDER -- stale by the time an async response
  // arrives if the user clicked something in between). A plain ref update
  // in an effect is enough here since those callbacks only ever run after a
  // real network round-trip, well past the next render.
  const entriesRef = useRef<PanelEntry[]>(entries)
  useEffect(() => {
    entriesRef.current = entries
  }, [entries])
  // Last-seen sentence context, purely as the effect trigger below -- the
  // displayed data itself lives in `entries` once the effect creates (or
  // updates) a SentenceEntry from it.
  const [pendingContext, setPendingContext] = useState<PendingSentenceContext | null>(null)
  // Words whose (often verbose) dictionary meaning the user has expanded past
  // the default 3-line clamp. Keyed by word only (not by scope) -- shared
  // across the top-level list and every sentence's nested list.
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
  const handleRemoveCard = useCallback((sentenceId: string | undefined, word: string) => {
    setEntries(prev => removeCard(prev, sentenceId, word))
    setExpandedWords(prev => {
      if (!prev.has(word)) return prev
      const next = new Set(prev)
      next.delete(word)
      return next
    })
  }, [])

  // Keep listening for a new sentence context: if the panel is already open
  // and the user clicks "整句翻译" on another word on the page, this fires
  // with the new context and a new SentenceEntry is prepended in place -- no
  // need to re-trigger sidePanel.open() (spec §3.3/§4.6). Initial mount-time
  // read is handled below, combined with LATEST_PAGE_WORD_STORAGE_KEY, so
  // whichever of the two actually happened more recently wins (ADR-006).
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

  // Mirrors a word looked up via the page's word popover into a top-level
  // card (ADR-006). Merges the already-fetched WordData directly -- no
  // re-fetch. ADR-023: unlike the pre-unification version, this never
  // touches any sentence's state -- a page click doesn't try to determine
  // which (if any) history sentence the word "belongs to" (Decision B2), so
  // an existing sentence entry is simply left alone.
  const mergePageWordLookup = useCallback((lookup: LatestPageWordLookup) => {
    const word = lookup.word.toLowerCase()
    setEntries(prev =>
      reorderOrInsertCard(prev, undefined, word, () => ({
        word,
        pronunciation: lookup.ecp.Pronunciation,
        loadCount: lookup.ecp.LoadCount,
        dictionaryChinese: lookup.ecp.Chinese,
        dictionaryStatus: 'loaded',
        contextStatus: 'none',
      }))
    )
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

  // Shared by every card-mutating callback below: fetches the word's meaning
  // in the given sentence and merges it into the matching card at `sentenceId`
  // (undefined = top-level), without touching the dictionary half.
  // dictionaryChinese, when given, is that word's dictionary definition --
  // looked up by the caller BEFORE this call (dictionary-first) -- embedded
  // in the AI prompt so the response's `why` can explain a divergence.
  // Callers with no dictionary entry to offer (a phrase, ADR-008) just omit
  // it.
  const fetchContextTranslation = useCallback(
    (word: string, sentence: string, sentenceId: string | undefined, dictionaryChinese?: string) => {
      sendMessageToBackground<BackgroundResponse>({
        type: 'translateWordInContext',
        word,
        sentence,
        dictionaryChinese,
      } satisfies ContentMessage)
        .then(response => {
          const resolved = response.success && response.chinese
          setEntries(prev =>
            patchCard(prev, sentenceId, word, {
              contextChinese: resolved ? response.chinese : undefined,
              contextWhy: resolved ? response.why || undefined : undefined,
              contextError: resolved ? undefined : response.error || 'Translation failed',
              contextErrorHttpStatus: resolved ? undefined : response.status,
              contextStatus: resolved ? 'loaded' : 'error',
            })
          )
        })
        .catch(() => {
          setEntries(prev =>
            patchCard(prev, sentenceId, word, {
              contextStatus: 'error',
              contextChinese: undefined,
              contextWhy: undefined,
              contextError: 'Translation failed',
              contextErrorHttpStatus: undefined,
            })
          )
        })
    },
    []
  )

  // Fetches the dictionary half of a card (pronunciation + ECDICT Chinese +
  // Query Count) via the same getOneWord lookup the page's word popup uses,
  // and resolves with the looked-up Chinese definition (or undefined on
  // failure/no entry) so callers can feed it into a subsequent
  // dictionary-first AI call (see fetchWordContext below).
  // NOTE: getOneWord increments the server-side Query Count, so callers must
  // only run this once per word -- never for a card that already has it.
  const fetchDictionary = useCallback(
    (word: string, sentenceId: string | undefined): Promise<string | undefined> => {
      return sendMessageToBackground<BackgroundResponse>({
        type: 'getOneWord',
        word,
      } satisfies ContentMessage)
        .then(response => {
          setEntries(prev =>
            patchCard(prev, sentenceId, word, {
              pronunciation: response.success ? response.ecp?.Pronunciation : undefined,
              dictionaryChinese: response.success ? response.ecp?.Chinese : undefined,
              loadCount: response.success ? response.ecp?.LoadCount : undefined,
              dictionaryStatus: response.success ? 'loaded' : 'error',
              dictionaryError: response.success ? undefined : response.error || 'Dictionary lookup failed',
              dictionaryErrorHttpStatus: response.success ? undefined : response.status,
            })
          )
          return response.success ? response.ecp?.Chinese : undefined
        })
        .catch(() => {
          setEntries(prev =>
            patchCard(prev, sentenceId, word, {
              dictionaryStatus: 'error',
              dictionaryError: 'Dictionary lookup failed',
              dictionaryErrorHttpStatus: undefined,
            })
          )
          return undefined
        })
    },
    []
  )

  // The single entry point for "look up a word's dictionary AND context
  // meaning, dictionary-first" (used by every single-word lookup -- the
  // anchor word from a page click, an in-sentence word click, and a retry
  // that needs the dictionary redone). The dictionary result renders
  // immediately via fetchDictionary's own patchCard; only once it resolves
  // (successfully or not) does the AI call fire, so the model always has
  // whatever dictionary definition is available to compare against. A
  // phrase (ADR-008) has no dictionary entry and skips this entirely,
  // calling fetchContextTranslation directly instead.
  const fetchWordContext = useCallback(
    (word: string, sentence: string, sentenceId: string | undefined) => {
      fetchDictionary(word, sentenceId).then(dictionaryChinese => {
        fetchContextTranslation(word, sentence, sentenceId, dictionaryChinese)
      })
    },
    [fetchDictionary, fetchContextTranslation]
  )

  // Runs when a SentenceEntry is created from a page word click: seeds a
  // card for the anchor word (the word this sentence was opened for) right
  // away, nested into the SAME brand-new entry, and kicks off the same
  // dictionary-first lookup (fetchWordContext) as any other word click --
  // this fires independently of the sentence's own whole-sentence
  // translation (they must not block each other). The entry is usually
  // brand new when this runs, so there's usually no existing card at this
  // scope -- EXCEPT the entry (and its <mark>-highlighted anchor word)
  // render synchronously just before this runs, so in principle the user
  // could click that highlighted word (handleWordClick) in the same tick.
  // Guard against that race the same way the pre-ADR-023 version did: if a
  // card already exists, just reorder it -- never re-seed/re-fetch (would
  // double the Query Count and double-charge the AI call for the same
  // word).
  const seedAnchorWord = useCallback(
    (sentenceId: string, rawWord: string, sentence: string) => {
      const word = rawWord.toLowerCase()
      const existing = findCard(entriesRef.current, sentenceId, word)

      if (existing) {
        setEntries(prev => reorderOrInsertCard(prev, sentenceId, word, () => existing))
        return
      }

      setEntries(prev =>
        reorderOrInsertCard(prev, sentenceId, word, () => ({
          word,
          dictionaryStatus: 'loading',
          contextStatus: 'loading',
        }))
      )
      fetchWordContext(word, sentence, sentenceId)
    },
    [fetchWordContext]
  )

  // Re-translate whenever a new sentence context arrives (and it isn't a
  // phrase context -- see the effect below for that). Prepends a new
  // SentenceEntry and fills it in as the translation resolves. Keyed on
  // createdAt so re-opening the same sentence still creates a fresh entry
  // and re-fetches (spec: re-translate on every open).
  useEffect(() => {
    if (!pendingContext || pendingContext.phrase) return

    const id = `${pendingContext.sourceUrl || ''}#${pendingContext.createdAt}`
    const sentence = pendingContext.sentence
    const anchorWord = pendingContext.word?.trim() || ''
    const clickedWord = anchorWord.toLowerCase()

    setEntries(prev => [
      {
        kind: 'sentence',
        id,
        sourceUrl: pendingContext.sourceUrl,
        sentence,
        clickedWord,
        status: 'loading',
        chinese: '',
        errorMessage: '',
        errorHttpStatus: undefined,
        words: [],
      },
      ...prev,
    ])

    // The anchor word's dictionary-first lookup is entirely independent of
    // the whole-sentence translation below -- neither should block the
    // other -- so it fires here, not inside that request's .then().
    if (anchorWord) seedAnchorWord(id, anchorWord, sentence)

    let cancelled = false

    sendMessageToBackground<BackgroundResponse>({ type: 'translateSentence', sentence } satisfies ContentMessage)
      .then(response => {
        if (cancelled) return
        if (response.success && response.chinese) {
          const chinese = response.chinese
          setEntries(prev =>
            prev.map(e => (e.kind === 'sentence' && e.id === id ? { ...e, chinese, status: 'loaded' } : e))
          )
        } else {
          const errorMessage = response.error || 'Translation service unavailable'
          const errorHttpStatus = response.status
          setEntries(prev =>
            prev.map(e =>
              e.kind === 'sentence' && e.id === id
                ? { ...e, errorMessage, errorHttpStatus, status: 'error' }
                : e
            )
          )
        }
      })
      .catch(error => {
        if (cancelled) return
        console.error('SidePanel: sentence translation failed', error)
        setEntries(prev =>
          prev.map(e =>
            e.kind === 'sentence' && e.id === id
              ? { ...e, errorMessage: 'Translation service unavailable', errorHttpStatus: undefined, status: 'error' }
              : e
          )
        )
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingContext?.createdAt])

  // Phrase-in-context lookup (ADR-008/017): a multi-word selection never has a
  // dictionary entry (ECDICT/words only has single words), so it skips
  // getOneWord entirely and only ever gets an AI translateWordInContext
  // result -- rendered as a phrase card (dictionaryStatus 'none').
  // `sentenceId` undefined means a top-level card (a main-page drag-select,
  // ADR-008 -- there's no displayed sentence to nest it under); set means
  // nested into that SentenceEntry's own `words` (an in-panel drag-select,
  // ADR-017). Re-selecting a phrase already at that scope just moves its
  // card up -- no second AI call, no second charge.
  const upsertPhraseCard = useCallback(
    (phrase: string, sentence: string, sentenceId: string | undefined) => {
      const alreadyExists = !!findCard(entries, sentenceId, phrase)
      setEntries(prev =>
        reorderOrInsertCard(prev, sentenceId, phrase, () => ({
          word: phrase,
          dictionaryStatus: 'none',
          contextStatus: 'loading',
          contextSentence: sentenceId === undefined ? sentence : undefined,
        }))
      )
      if (!alreadyExists) fetchContextTranslation(phrase, sentence, sentenceId)
    },
    [entries, fetchContextTranslation]
  )

  // A phrase arriving via pendingContext (ADR-008: drag-selected on the web
  // page, already confirmed there) goes straight to a top-level card -- no
  // confirm button, unlike an in-panel drag-select (ADR-017), and no
  // SentenceEntry is created for it (the top status area stays reserved for
  // a genuine whole-sentence translation).
  useEffect(() => {
    if (pendingContext?.phrase) {
      upsertPhraseCard(pendingContext.phrase, pendingContext.sentence, undefined)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingContext?.createdAt])

  // Lets a card stuck in contextStatus 'error' (e.g. session expiry) recover
  // without a full page reload. Recovers the sentence text from the owning
  // SentenceEntry when nested, or from the card's own `contextSentence` when
  // it's a top-level phrase card (ADR-023 -- there's no ambient "current
  // sentence" singleton anymore to fall back on). Three cases, by what the
  // dictionary half is doing: a phrase card (dictionaryStatus 'none') has no
  // dictionary to redo, so just retry the AI call alone; a card whose
  // dictionary already loaded reuses that definition rather than re-running
  // getOneWord (would double the Query Count); anything else (dictionary
  // itself never resolved, e.g. also hit the same session expiry) redoes
  // the whole dictionary-first chain.
  const handleRetryContextTranslation = useCallback(
    (sentenceId: string | undefined, word: string) => {
      const sentenceEntry = sentenceId
        ? entries.find((e): e is SentenceEntry => e.kind === 'sentence' && e.id === sentenceId)
        : undefined
      const card = findCard(entries, sentenceId, word)
      const sentence = sentenceEntry?.sentence ?? card?.contextSentence
      if (!sentence) return

      if (card?.dictionaryStatus === 'none') {
        setEntries(prev => patchCard(prev, sentenceId, word, { contextStatus: 'loading', contextError: undefined }))
        fetchContextTranslation(word, sentence, sentenceId)
        return
      }

      if (card?.dictionaryStatus === 'loaded') {
        setEntries(prev => patchCard(prev, sentenceId, word, { contextStatus: 'loading', contextError: undefined }))
        fetchContextTranslation(word, sentence, sentenceId, card.dictionaryChinese)
        return
      }

      setEntries(prev =>
        patchCard(prev, sentenceId, word, {
          dictionaryStatus: 'loading',
          dictionaryError: undefined,
          contextStatus: 'loading',
          contextError: undefined,
        })
      )
      fetchWordContext(word, sentence, sentenceId)
    },
    [entries, fetchContextTranslation, fetchWordContext]
  )

  // A single-word selection inside a sentence's own rendered original
  // (ADR-017) -- always nested into that entry's `words` (`sentenceId` is
  // always defined here; only page clicks and main-page phrases populate the
  // top-level list). Runs the same dictionary-first lookup (fetchWordContext)
  // as an anchor word click (spec §3.7/§3.8/§3.9): the dictionary half
  // renders as soon as it resolves, then the AI call fires with that
  // definition. Re-clicking a word already nested here just moves its card
  // up instead of re-fetching (spec §3.9). A card with contextStatus 'none'
  // can't occur at this scope (only a page-lookup card is ever 'none', and
  // those are always top-level).
  const handleWordClick = useCallback(
    (rawWord: string, sentence: string, sentenceId: string) => {
      const word = rawWord.toLowerCase()
      const existing = findCard(entries, sentenceId, word)
      if (existing) {
        setEntries(prev => reorderOrInsertCard(prev, sentenceId, word, () => existing))
        return
      }
      setEntries(prev =>
        reorderOrInsertCard(prev, sentenceId, word, () => ({
          word,
          dictionaryStatus: 'loading',
          contextStatus: 'loading',
        }))
      )
      fetchWordContext(word, sentence, sentenceId)
    },
    [entries, fetchWordContext]
  )

  // The guided hint only makes sense when the panel has shown nothing at
  // all yet.
  if (entries.length === 0) {
    return (
      <div className="p-4 text-gray-500 text-sm" data-testid="sidepanel-empty-state">
        Click any highlighted word in the page text, then click the sentence-translation icon in the popup. The full English sentence and its Chinese translation will appear here.
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4 text-sm">
      <div className="flex items-center justify-end">
        <button
          type="button"
          data-testid="sidepanel-clear-all"
          onClick={() => {
            setEntries([])
            setExpandedWords(new Set())
          }}
          className="text-xs text-gray-400 hover:text-red-500"
        >
          Clear
        </button>
      </div>

      {entries.map(entry =>
        entry.kind === 'sentence' ? (
          <SentenceBlock
            key={entry.id}
            entry={entry}
            expandedWords={expandedWords}
            onToggleExpand={toggleExpanded}
            onWordClick={(sentenceId, sentence, word) => handleWordClick(word, sentence, sentenceId)}
            onPhraseConfirm={(sentenceId, sentence, phrase) => upsertPhraseCard(phrase, sentence, sentenceId)}
            onRemoveWord={handleRemoveCard}
            onRetryContext={handleRetryContextTranslation}
          />
        ) : (
          <WordCard
            key={entry.word}
            card={entry}
            expanded={expandedWords.has(entry.word)}
            onToggleExpand={() => toggleExpanded(entry.word)}
            onRemove={() => handleRemoveCard(undefined, entry.word)}
            onRetryContext={() => handleRetryContextTranslation(undefined, entry.word)}
          />
        )
      )}
    </div>
  )
}

export default function SidePanel() {
  return <SidePanelContent />
}
