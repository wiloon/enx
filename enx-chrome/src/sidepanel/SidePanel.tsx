import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import '@/index.css'
import {
  ArrowPathRoundedSquareIcon,
  MagnifyingGlassIcon,
  SpeakerWaveIcon,
  XMarkIcon,
} from '@heroicons/react/20/solid'
import { initSentry } from '@/lib/sentry'
import { lookupCountLabel } from '@/lib/lookupCount'
import { formatPhonetic } from '@/lib/phonetic'
import { playPronunciation } from '@/lib/pronunciation'
import { cardHasSpeaker } from '@/lib/speaker'
import { snapToWordBounds } from '@/lib/wordSegment'
import {
  HIGHLIGHT_NAME_PREFIX,
  reviewBucketHighlightCss,
  sentenceHighlightSpans,
  wordKey,
  type CharSpan,
  type SentenceHighlightSpans,
} from '@/lib/wordHighlight'
import { sendMessageToBackground } from '@/services/api'
import { countLookup, type RecordLookup } from '@/lib/queryCount'
import { isLookupQuotaExceeded } from '@/lib/rateLimit'
import { config } from '@/config/env'
import LoadingSkeleton from '@/components/LoadingSkeleton'
import {
  WORD_HIGHLIGHT_KEY,
  getWordHighlightEnabled,
} from '@/config/preferences'
import {
  latestPageWordKey,
  panelTabIdFromUrl,
  pendingSentenceKey,
} from '@/lib/sidePanel'
import {
  adjacentPageCard,
  findCard,
  findSentence,
  moveSentenceToTop,
  panelCardKey,
  patchCard,
  patchSentence,
  removeCard,
  reorderOrInsertCard,
  sentenceCardId,
  topLevelPhraseCardKey,
  wordCardKey,
  type PanelEntry,
  type SentenceEntry,
  type WordCardData,
} from '@/lib/panelHistory'
import {
  BackgroundResponse,
  ContentMessage,
  LatestPageWordLookup,
  PanelWordLookupMessage,
  PendingSentenceContext,
  WordData,
} from '@/types'

initSentry()

// Billing-related HTTP statuses the backend can return from the AI
// translate and dictionary lookup endpoints (see billing/handler.go and
// dictionary/lookup.go). Kept as named constants so the render logic below
// reads as intent, not magic numbers.
const HTTP_INSUFFICIENT_CREDIT = 402

// Opens enx-ui's billing page in a new browser tab (not chrome.tabs.create,
// which needs an extension-privileged context the Side Panel's rendered
// content doesn't have -- a plain link works fine here).
function UpgradeLink({ className }: { className?: string }) {
  return (
    <a
      href={`${config.frontendBaseUrl}/billing`}
      target="_blank"
      rel="noopener noreferrer"
      className={
        className ?? 'text-brand hover:underline font-medium whitespace-nowrap'
      }
    >
      Subscribe / add credit
    </a>
  )
}

// The sentence original's word-level marks (ADR-053): the anchor word's
// background and the review-stage underlines are CSS Custom Highlight API
// Ranges over the sentence's single text node, never elements -- the same
// mechanism and palette as the page (ADR-011). The panel is its own
// document, so it reuses the page's enx-hl-N names without clashing.
// The anchor wash is brand, not the page's yellow sentence wash: each colour
// has one job (ADR-054).
const ANCHOR_HIGHLIGHT_NAME = 'enx-sp-anchor'

const sidePanelHighlightStyles = document.createElement('style')
sidePanelHighlightStyles.setAttribute('data-enx-highlight-styles', 'true')
sidePanelHighlightStyles.textContent =
  reviewBucketHighlightCss() +
  `\n::highlight(${ANCHOR_HIGHLIGHT_NAME}) {` +
  ` background-color: color-mix(in oklab, var(--color-brand) 25%, transparent); }`
if (!document.head.querySelector('style[data-enx-highlight-styles]')) {
  document.head.appendChild(sidePanelHighlightStyles)
}

// Replaces every sentence-original highlight in the panel with Ranges built
// from `sentences` (each one's text node plus the spans to mark in it).
// Rebuilt in full after each render: React may have swapped the text nodes,
// which leaves any earlier Range pointing at a detached node.
const applySentenceHighlights = (
  sentences: { node: Text; spans: SentenceHighlightSpans }[]
) => {
  for (const name of [...CSS.highlights.keys()]) {
    if (
      name === ANCHOR_HIGHLIGHT_NAME ||
      name.startsWith(HIGHLIGHT_NAME_PREFIX)
    ) {
      CSS.highlights.delete(name)
    }
  }

  const toRange = (node: Text, { start, end }: CharSpan) => {
    const range = document.createRange()
    range.setStart(node, start)
    range.setEnd(node, end)
    return range
  }
  const anchor: Range[] = []
  const buckets = new Map<number, Range[]>()
  for (const { node, spans } of sentences) {
    anchor.push(...spans.anchor.map(span => toRange(node, span)))
    for (const [bucket, bucketSpans] of spans.buckets) {
      const ranges = buckets.get(bucket) ?? []
      ranges.push(...bucketSpans.map(span => toRange(node, span)))
      buckets.set(bucket, ranges)
    }
  }

  if (anchor.length > 0) {
    CSS.highlights.set(ANCHOR_HIGHLIGHT_NAME, new Highlight(...anchor))
  }
  for (const [bucket, ranges] of buckets) {
    CSS.highlights.set(
      `${HIGHLIGHT_NAME_PREFIX}${bucket}`,
      new Highlight(...ranges)
    )
  }
}

// Character offset of a (node, offset) selection boundary within `root`'s
// text, computed by measuring the flattened text before it. Works regardless
// of how the text is split into nodes, and is testable in
// jsdom since Range.toString() is implemented there.
const boundaryCharOffset = (
  root: HTMLElement,
  node: Node,
  offset: number
): number => {
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
  if (!root.contains(sel.anchorNode) || !root.contains(sel.focusNode))
    return null
  const r = sel.getRangeAt(0)
  const a = boundaryCharOffset(root, r.startContainer, r.startOffset)
  const b = boundaryCharOffset(root, r.endContainer, r.endOffset)
  return a <= b ? [a, b] : [b, a]
}

// Counts a word clicked in the panel on the server, without waiting
// (lib/queryCount.ts).
const countOnServer: RecordLookup = wordId => {
  void sendMessageToBackground({
    type: 'recordWordLookup',
    wordId,
  } satisfies ContentMessage).catch(() => {})
}

// The card a request writes back to, and the token it started with.
interface CardRef {
  sentenceId: string | undefined
  key: string
  token: number
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
  const left = rect
    ? Math.max(4, Math.min(rect.left, window.innerWidth - 40))
    : 4

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
      className="z-10 inline-flex items-center rounded-md border border-brand/25 bg-brand-muted px-2 py-1 text-brand shadow-xs hover:bg-brand/15"
    >
      <MagnifyingGlassIcon className="h-4 w-4" aria-hidden="true" />
    </button>
  )
}

// What an AI-call error row says: a 402 is the user's credit running out,
// which reads better as that than as the server's own wording.
function contextErrorDisplay(
  message: string | undefined,
  httpStatus: number | undefined
): string | undefined {
  return httpStatus === HTTP_INSUFFICIENT_CREDIT
    ? 'Not enough AI translation credit'
    : message
}

// One word/phrase card: headline (word + phonetic + play + lookup count),
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
  shownAbove,
  nested = false,
}: {
  card: WordCardData
  expanded: boolean
  onToggleExpand: () => void
  onRemove: () => void
  onRetryContext: () => void
  // Error text the owning sentence already shows, with a Retry that also
  // covers this card -- a row repeating it would be the same failure twice.
  shownAbove?: string
  // Looked up inside a sentence entry: drawn as a teal rule hanging off the
  // sentence rather than a second card inside the sentence's card, so it
  // reads as "belongs to this sentence" and keeps the width (ADR-023).
  nested?: boolean
}) {
  const phonetic = formatPhonetic(card.pronunciation)
  const hasSpeaker = cardHasSpeaker(card)
  // One failure (the API down for a moment) fails the dictionary and the AI
  // halves alike; show its message once. The context row is the one kept:
  // its Retry redoes the dictionary too when that never loaded.
  const contextErrorText =
    card.contextStatus === 'error'
      ? contextErrorDisplay(card.contextError, card.contextErrorHttpStatus)
      : undefined
  const quotaExceeded = isLookupQuotaExceeded({
    status: card.dictionaryErrorHttpStatus,
    code: card.dictionaryErrorCode,
  })
  const dictionaryErrorText =
    card.dictionaryStatus === 'error'
      ? quotaExceeded
        ? "You've used up today's free lookups"
        : card.dictionaryError
      : undefined
  const showContextError =
    contextErrorText !== undefined && contextErrorText !== shownAbove
  const showDictionaryError =
    dictionaryErrorText !== undefined &&
    dictionaryErrorText !== shownAbove &&
    dictionaryErrorText !== contextErrorText
  const dictLong =
    !!card.dictionaryChinese &&
    (card.dictionaryChinese.length > 40 ||
      card.dictionaryChinese.includes('\n'))

  return (
    <div
      className={
        nested
          ? 'group relative border-l-2 border-brand/40 py-0.5 pl-3 hover:border-brand'
          : 'group relative rounded-lg border border-border bg-background px-3 py-2.5 hover:bg-muted'
      }
      data-testid={`sidepanel-card-${card.word}`}
    >
      {/* Headline: word + phonetic + play + lookup count on one row. The
          contextual meaning is NOT here -- it's in the meaning block below
          with a 本句 tag so it reads as "this word, in this sentence" rather
          than competing with the phonetic for the same line. */}
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 pr-5">
        <span className="font-semibold text-foreground">{card.word}</span>

        {card.dictionaryStatus === 'loading' ? (
          <span className="text-muted-foreground text-xs">
            Loading phonetics...
          </span>
        ) : (
          (phonetic || hasSpeaker) && (
            // With no phonetic text the speaker alone has no baseline to
            // share with the word, so it is centred on the row instead.
            <span
              className={`inline-flex items-center gap-1${phonetic ? '' : ' self-center'}`}
            >
              {phonetic && (
                <span className="text-muted-foreground text-xs">
                  {phonetic}
                </span>
              )}
              {hasSpeaker && (
                <button
                  data-testid={`sidepanel-play-pronunciation-${card.word}`}
                  type="button"
                  onClick={() => playPronunciation(card.word)}
                  className="text-muted-foreground hover:text-brand leading-none p-1 -m-1"
                  aria-label="Play pronunciation"
                  title="Play pronunciation"
                >
                  <SpeakerWaveIcon
                    className="h-3.5 w-3.5 block"
                    aria-hidden="true"
                  />
                </button>
              )}
            </span>
          )
        )}

        {card.loadCount !== undefined && (
          <span
            className="inline-flex items-center gap-0.5 text-xs text-muted-foreground ml-auto whitespace-nowrap tabular-nums"
            title={lookupCountLabel(card.loadCount)}
          >
            <ArrowPathRoundedSquareIcon
              className="h-3.5 w-3.5"
              aria-hidden="true"
            />
            <span aria-hidden="true">{card.loadCount}</span>
            <span className="sr-only">{lookupCountLabel(card.loadCount)}</span>
          </span>
        )}
      </div>

      {/* Dismiss this card -- the list otherwise only grows. */}
      <button
        type="button"
        data-testid={`sidepanel-remove-${card.word}`}
        onClick={onRemove}
        className="absolute top-1.5 right-1.5 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
        title="Remove"
        aria-label={`Remove ${card.word}`}
      >
        <XMarkIcon className="h-4 w-4" aria-hidden="true" />
      </button>

      {/* Kept off the headline row: an error (e.g. session expiry) read as a
          real translation there. Its own row + retry button makes it
          obviously an error and recoverable. */}
      {showContextError && (
        <div
          className="flex items-center justify-between gap-2 text-destructive text-xs bg-destructive/10 rounded-sm px-2 py-1 mt-2"
          data-testid={`sidepanel-context-error-${card.word}`}
        >
          <span className="flex-1">{contextErrorText}</span>
          {card.contextErrorHttpStatus === HTTP_INSUFFICIENT_CREDIT && (
            <UpgradeLink className="text-destructive hover:text-destructive/80 font-medium whitespace-nowrap underline" />
          )}
          <button
            type="button"
            data-testid={`sidepanel-retry-context-${card.word}`}
            onClick={onRetryContext}
            className="text-destructive hover:text-destructive/80 font-medium whitespace-nowrap"
            title="Retry"
          >
            Retry
          </button>
        </div>
      )}

      {/* Dictionary half's own error row -- the free daily lookup quota
          (TASK-SPEC §4.2) gets an upgrade link; any other failure, the
          request rate limit's 429 included, shows its own message. */}
      {showDictionaryError && (
        <div
          className="flex items-center justify-between gap-2 text-destructive text-xs bg-destructive/10 rounded-sm px-2 py-1 mt-2"
          data-testid={`sidepanel-dictionary-error-${card.word}`}
        >
          <span className="flex-1">{dictionaryErrorText}</span>
          {quotaExceeded && (
            <UpgradeLink className="text-destructive hover:text-destructive/80 font-medium whitespace-nowrap underline" />
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
            <LoadingSkeleton label="Translating..." lines={['w-2/3']} />
          )}
          {card.contextStatus === 'loaded' && (
            <p className="text-sm text-brand">
              <span className="mr-1.5 rounded-sm bg-brand-muted px-1 py-0.5 text-[10px] font-medium text-brand">
                in context
              </span>
              <span className="font-medium">{card.contextChinese}</span>
            </p>
          )}
          {card.contextStatus === 'loaded' && card.contextWhy && (
            <p
              data-testid={`sidepanel-context-why-${card.word}`}
              className="text-xs italic text-muted-foreground"
            >
              {card.contextWhy}
            </p>
          )}

          {card.dictionaryStatus === 'loading' ? (
            <p className="text-muted-foreground text-xs">
              Loading dictionary definition...
            </p>
          ) : (
            card.dictionaryChinese && (
              <div>
                <p
                  className={`text-muted-foreground text-sm whitespace-pre-line ${expanded ? '' : 'line-clamp-3'}`}
                >
                  {card.dictionaryChinese}
                </p>
                {dictLong && (
                  <button
                    type="button"
                    data-testid={`sidepanel-toggle-meaning-${card.word}`}
                    onClick={onToggleExpand}
                    className="text-xs text-muted-foreground hover:text-brand mt-0.5"
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

// How long Clear keeps the removed list around for Undo.
const CLEAR_UNDO_MS = 5000

// The slim row above the list: what the list is on the left, its one action
// on the right. Sticky, so Clear (or Undo) stays reachable in a long list.
function PanelToolbar({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="sticky top-0 z-10 -mx-4 mb-1 flex h-8 items-center justify-between bg-background px-4 text-xs text-muted-foreground">
      <span>{label}</span>
      {children}
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
  onRetrySentence,
}: {
  entry: SentenceEntry
  // panelCardKey of every expanded card.
  expandedWords: Set<string>
  onToggleExpand: (cardKey: string) => void
  onWordClick: (sentenceId: string, sentence: string, word: string) => void
  onPhraseConfirm: (
    sentenceId: string,
    sentence: string,
    phrase: string
  ) => void
  onRemoveWord: (sentenceId: string, key: string) => void
  onRetryContext: (sentenceId: string, key: string) => void
  onRetrySentence: (sentenceId: string) => void
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

  const sentenceErrorText =
    entry.status === 'error'
      ? contextErrorDisplay(entry.errorMessage, entry.errorHttpStatus)
      : undefined

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
    const { text, wordCount } = snapToWordBounds(
      entry.sentence,
      range[0],
      range[1]
    )
    if (wordCount === 0) return
    if (wordCount === 1) {
      onWordClick(entry.id, entry.sentence, text)
      return
    }
    // Whole sentence (or more) selected -- the status area already covers it.
    if (wordCount >= sentenceWordCount) return
    // Already looked up in this sentence -- skip the confirm step, resurface it.
    if (entry.words.some(w => w.key === wordCardKey(text))) {
      onPhraseConfirm(entry.id, entry.sentence, text)
      return
    }
    const sel = window.getSelection()
    // jsdom's Range has no getBoundingClientRect; guard so the handler stays
    // callable there (position is best-effort anyway).
    const r = sel?.rangeCount ? sel.getRangeAt(0) : null
    const domRect =
      r && typeof r.getBoundingClientRect === 'function'
        ? r.getBoundingClientRect()
        : null
    setPendingPhrase({
      text,
      rect: domRect ? { bottom: domRect.bottom, left: domRect.left } : null,
    })
  }, [
    entry,
    sentenceWordCount,
    onWordClick,
    onPhraseConfirm,
    clearPendingPhrase,
  ])

  return (
    <div
      data-testid={`sidepanel-sentence-entry-${entry.id}`}
      className="space-y-3 rounded-lg border border-border bg-muted p-3"
    >
      <div>
        <p
          ref={sentenceRef}
          className="text-foreground leading-relaxed select-text"
          data-testid="sidepanel-sentence"
          data-entry-id={entry.id}
          onMouseUp={handleSentenceSelection}
        >
          {entry.sentence}
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

      <div className="border-t border-border pt-3">
        {entry.status === 'loading' && (
          <LoadingSkeleton
            label="Translating..."
            lines={['w-full', 'w-5/6', 'w-2/3']}
            testId="sidepanel-loading"
          />
        )}
        {entry.status === 'error' && (
          <div
            className="flex items-center justify-between gap-2 flex-wrap text-destructive"
            data-testid="sidepanel-error"
          >
            <span className="flex-1">{sentenceErrorText}</span>
            {entry.errorHttpStatus === HTTP_INSUFFICIENT_CREDIT && (
              <UpgradeLink />
            )}
            <button
              type="button"
              data-testid="sidepanel-retry-sentence"
              onClick={() => onRetrySentence(entry.id)}
              className="text-destructive hover:text-destructive/80 font-medium whitespace-nowrap"
              title="Retry"
            >
              Retry
            </button>
          </div>
        )}
        {entry.status === 'loaded' && (
          <p className="text-foreground" data-testid="sidepanel-chinese">
            {entry.chinese}
          </p>
        )}
      </div>

      {entry.words.length > 0 && (
        <div data-testid="sidepanel-sentence-words" className="space-y-2">
          {entry.words.map(card => (
            <WordCard
              key={card.key}
              card={card}
              expanded={expandedWords.has(panelCardKey(entry.id, card.key))}
              onToggleExpand={() =>
                onToggleExpand(panelCardKey(entry.id, card.key))
              }
              onRemove={() => onRemoveWord(entry.id, card.key)}
              onRetryContext={() => onRetryContext(entry.id, card.key)}
              shownAbove={sentenceErrorText}
              nested
            />
          ))}
        </div>
      )}
    </div>
  )
}

function SidePanelContent() {
  // The tab this panel belongs to, written into its URL by whoever opened it
  // (ADR-050). Undefined only for a stray panel with no owning tab -- that
  // one stays on the empty state and reads no tab's keys.
  const [tabId] = useState(() => panelTabIdFromUrl(window.location.href))
  // The unified, newest-on-top history list (ADR-023): word/phrase cards
  // that arrived without an owning sentence (page clicks, ADR-006; main-page
  // phrase drag-select, ADR-008) sit at the top level; a sentence
  // translation is its own entry that owns a nested `words` list for
  // anything looked up inside ITS OWN rendered original (ADR-017). A
  // reorder only ever happens at the scope the selection came from -- a
  // main-page click never searches history sentences for a match to nest
  // into (Decision B2), so scoping never needs cross-referencing.
  const [entries, setEntriesState] = useState<PanelEntry[]>([])
  // Always the latest list, for callbacks reached from inside a long-lived
  // effect closure or an async response: written in the same call as the
  // state, so a token check never reads a list React hasn't rendered yet.
  const entriesRef = useRef<PanelEntry[]>(entries)
  const setEntries = useCallback(
    (update: PanelEntry[] | ((prev: PanelEntry[]) => PanelEntry[])) => {
      entriesRef.current =
        typeof update === 'function' ? update(entriesRef.current) : update
      setEntriesState(entriesRef.current)
    },
    []
  )
  // Request tokens (ADR-023 Decision 8): each request a card waits on takes
  // the next value, and its response is written only while the card found
  // by id/key still carries it.
  const lastTokenRef = useRef(0)
  const nextToken = useCallback(() => ++lastTokenRef.current, [])
  // Last-seen sentence context, purely as the effect trigger below -- the
  // displayed data itself lives in `entries` once the effect creates (or
  // updates) a SentenceEntry from it.
  const [pendingContext, setPendingContext] =
    useState<PendingSentenceContext | null>(null)
  // Cards whose (often verbose) dictionary meaning the user has expanded past
  // the default 3-line clamp, by panelCardKey.
  const [expandedWords, setExpandedWords] = useState<Set<string>>(new Set())
  // What Clear just removed, kept for a few seconds so Undo can put it back.
  const [cleared, setCleared] = useState<{
    entries: PanelEntry[]
    expandedWords: Set<string>
  } | null>(null)
  useEffect(() => {
    if (!cleared) return
    const timer = setTimeout(() => setCleared(null), CLEAR_UNDO_MS)
    return () => clearTimeout(timer)
  }, [cleared])
  // A lookup after Clear starts a fresh list; Undo would mix the two.
  // Adjusted during render rather than in an effect, as React recommends.
  if (cleared && entries.length > 0) setCleared(null)
  // What the panel knows about each word's review stage, keyed by
  // lower-cased word like the page's wordCache (ADR-053 Decision 3). Drives
  // the underlines in every sentence original.
  const [wordStates, setWordStates] = useState<Record<string, WordData>>({})
  // Optimistic broadcast (ADR-053): the page's markKnown request to
  // background reaches every extension page, this panel included. The panel
  // drops the underline at once, as the page does, without waiting for the
  // API. It only listens: background is the one replier, and a reply (or a
  // `return true`) from here would take the page's single response slot.
  useEffect(() => {
    const listener = (message: { type?: string; word?: string }) => {
      if (message.type !== 'markKnown' || !message.word) return
      const word = wordKey(message.word)
      setWordStates(prev =>
        prev[word] ? { ...prev, [word]: { ...prev[word], Known: true } } : prev
      )
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [])

  // The "highlight vocabulary while reading" preference governs the
  // underlines here as on the page (ADR-053 Decision 5), live. The anchor
  // word isn't vocabulary highlighting and ignores it.
  const [underlinesOn, setUnderlinesOn] = useState(true)
  useEffect(() => {
    let cancelled = false
    void getWordHighlightEnabled().then(enabled => {
      if (!cancelled) setUnderlinesOn(enabled)
    })
    const listener = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string
    ) => {
      if (areaName !== 'local' || !(WORD_HIGHLIGHT_KEY in changes)) return
      setUnderlinesOn(changes[WORD_HIGHLIGHT_KEY].newValue !== false)
    }
    chrome.storage.onChanged.addListener(listener)
    return () => {
      cancelled = true
      chrome.storage.onChanged.removeListener(listener)
    }
  }, [])

  const toggleExpanded = useCallback((cardKey: string) => {
    setExpandedWords(prev => {
      const next = new Set(prev)
      if (next.has(cardKey)) next.delete(cardKey)
      else next.add(cardKey)
      return next
    })
  }, [])

  // Removes a single card from the running list (ADR-006 list is append-only
  // otherwise, so a long reading session accumulates noise). Purely local --
  // nothing is persisted, re-clicking the word re-adds it.
  const handleRemoveCard = useCallback(
    (sentenceId: string | undefined, key: string) => {
      setEntries(prev => removeCard(prev, sentenceId, key))
      const cardKey = panelCardKey(sentenceId, key)
      setExpandedWords(prev => {
        if (!prev.has(cardKey)) return prev
        const next = new Set(prev)
        next.delete(cardKey)
        return next
      })
    },
    [setEntries]
  )

  // Keep listening for a new sentence context: if the panel is already open
  // and the user clicks "整句翻译" on another word on the page, this fires
  // with the new context and a new SentenceEntry is prepended in place -- no
  // need to re-trigger sidePanel.open() (spec §3.3/§4.6). Initial mount-time
  // read is handled below, combined with the latest page word, so whichever
  // of the two actually happened more recently wins (ADR-006). Only this
  // panel's own tab's keys count (ADR-050).
  useEffect(() => {
    if (tabId === undefined) return
    const key = pendingSentenceKey(tabId)
    const listener = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string
    ) => {
      if (areaName !== 'session') return
      const change = changes[key]
      if (change?.newValue) {
        setPendingContext(change.newValue as PendingSentenceContext)
      }
    }
    chrome.storage.onChanged.addListener(listener)
    return () => chrome.storage.onChanged.removeListener(listener)
  }, [tabId])

  // Mirrors a word looked up via the page's word popover into a top-level
  // card (ADR-006). Merges the already-fetched WordData directly -- no
  // re-fetch. ADR-023: unlike the pre-unification version, this never
  // touches any sentence's state -- a page click doesn't try to determine
  // which (if any) history sentence the word "belongs to" (Decision B2), so
  // an existing sentence entry is simply left alone.
  const mergePageWordLookup = useCallback((lookup: LatestPageWordLookup) => {
    const word = wordKey(lookup.word)
    // The page already knows this word's new stage; only the panel's
    // underlines need it (ADR-053 Decision 3), so no message goes back.
    setWordStates(prev => ({ ...prev, [word]: lookup.ecp }))
    setEntries(prev =>
      reorderOrInsertCard(prev, undefined, wordCardKey(word), () => ({
        word,
        key: wordCardKey(word),
        pronunciation: lookup.ecp.Pronunciation,
        loadCount: lookup.ecp.LoadCount,
        dictionaryChinese: lookup.ecp.Chinese,
        dictionaryStatus: 'loaded',
        contextStatus: 'none',
      }))
    )
  }, [setEntries])

  useEffect(() => {
    if (tabId === undefined) return
    const key = latestPageWordKey(tabId)
    const listener = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string
    ) => {
      if (areaName !== 'session') return
      const change = changes[key]
      if (change?.newValue) {
        mergePageWordLookup(change.newValue as LatestPageWordLookup)
      }
    }
    chrome.storage.onChanged.addListener(listener)
    return () => chrome.storage.onChanged.removeListener(listener)
  }, [tabId, mergePageWordLookup])

  // One-time mount read of both storage keys together: whichever actually
  // happened more recently (by createdAt) wins, since the two independent
  // `.get()` calls above would otherwise race and let whichever Promise
  // settles last clobber the other regardless of real chronological order.
  useEffect(() => {
    if (tabId === undefined) return
    const sentenceKey = pendingSentenceKey(tabId)
    const wordKey = latestPageWordKey(tabId)
    Promise.all([
      chrome.storage.session.get(sentenceKey),
      chrome.storage.session.get(wordKey),
    ]).then(([sentenceResult, wordResult]) => {
      const sentence = sentenceResult[sentenceKey] as
        PendingSentenceContext | undefined
      const word = wordResult[wordKey] as LatestPageWordLookup | undefined

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
    (
      word: string,
      sentence: string,
      card: CardRef,
      dictionaryChinese?: string
    ) => {
      const patch = (fields: Partial<WordCardData>) =>
        setEntries(prev =>
          patchCard(prev, card.sentenceId, card.key, fields, card.token)
        )
      sendMessageToBackground<BackgroundResponse>({
        type: 'translateWordInContext',
        word,
        sentence,
        dictionaryChinese,
      } satisfies ContentMessage)
        .then(response => {
          const resolved = response.success && response.chinese
          patch({
            contextChinese: resolved ? response.chinese : undefined,
            contextWhy: resolved ? response.why || undefined : undefined,
            contextError: resolved
              ? undefined
              : response.error || 'Translation failed',
            contextErrorHttpStatus: resolved ? undefined : response.status,
            contextStatus: resolved ? 'loaded' : 'error',
          })
        })
        .catch(() => {
          patch({
            contextStatus: 'error',
            contextChinese: undefined,
            contextWhy: undefined,
            contextError: 'Translation failed',
            contextErrorHttpStatus: undefined,
          })
        })
    },
    [setEntries]
  )

  // Whether `card` is still waiting on the request its token started.
  const holdsToken = useCallback(
    (card: CardRef) =>
      findCard(entriesRef.current, card.sentenceId, card.key)?.token ===
      card.token,
    []
  )

  // A single word looked up in the panel (ADR-053 Decision 3/4): its new
  // review stage underlines it here, and the page is told so its own
  // wordCache and underlines catch up without a reload. No content script
  // on the tab (ENX not enabled there, or the tab navigated away) is fine:
  // the click was counted on the server, so the next page that enables
  // ENX underlines the word anyway.
  const recordWordLookup = useCallback(
    (word: string, ecp: WordData) => {
      setWordStates(prev => ({ ...prev, [wordKey(word)]: ecp }))
      if (tabId === undefined) return
      const message: PanelWordLookupMessage = {
        action: 'panelWordLookup',
        word: word.toLowerCase(),
        ecp,
      }
      chrome.tabs.sendMessage(tabId, message).catch(() => {})
    },
    [tabId]
  )

  // Fetches the dictionary half of a card (pronunciation + ECDICT Chinese +
  // Query Count) via the same getOneWord lookup the page's word popup uses,
  // and resolves with the looked-up Chinese definition (or undefined on
  // failure/no entry) so callers can feed it into a subsequent
  // dictionary-first AI call (see fetchWordContext below). getOneWord only
  // reads, so this may run as often as needed (ADR-059 Decision 7).
  // `counts` is true only for a word clicked in the panel: that click is a
  // lookup and is counted once (lib/queryCount.ts). A card for a word the
  // page's popover already looked up -- a sentence's anchor word, a retry --
  // must not count it again. A response for a card that no longer holds
  // the token (removed, cleared, recreated) does nothing and resolves
  // `current: false`, so the chain stops there.
  const fetchDictionary = useCallback(
    (
      word: string,
      card: CardRef,
      counts: boolean
    ): Promise<{ current: boolean; chinese?: string }> => {
      const patch = (fields: Partial<WordCardData>) =>
        setEntries(prev =>
          patchCard(prev, card.sentenceId, card.key, fields, card.token)
        )
      return sendMessageToBackground<BackgroundResponse>({
        type: 'getOneWord',
        word,
      } satisfies ContentMessage)
        .then(response => {
          if (!holdsToken(card)) return { current: false }
          const ecp =
            response.success && response.ecp && counts
              ? countLookup(response.ecp, countOnServer)
              : response.ecp
          if (response.success && ecp) {
            recordWordLookup(word, ecp)
          }
          patch({
            pronunciation: response.success ? ecp?.Pronunciation : undefined,
            dictionaryChinese: response.success ? ecp?.Chinese : undefined,
            loadCount: response.success ? ecp?.LoadCount : undefined,
            dictionaryStatus: response.success ? 'loaded' : 'error',
            dictionaryError: response.success
              ? undefined
              : response.error || 'Dictionary lookup failed',
            dictionaryErrorHttpStatus: response.success
              ? undefined
              : response.status,
            dictionaryErrorCode: response.success ? undefined : response.code,
          })
          return {
            current: true,
            chinese: response.success ? ecp?.Chinese : undefined,
          }
        })
        .catch(() => {
          if (!holdsToken(card)) return { current: false }
          patch({
            dictionaryStatus: 'error',
            dictionaryError: 'Dictionary lookup failed',
            dictionaryErrorHttpStatus: undefined,
            dictionaryErrorCode: undefined,
          })
          return { current: true }
        })
    },
    [recordWordLookup, holdsToken, setEntries]
  )

  // The single entry point for "look up a word's dictionary AND context
  // meaning, dictionary-first" (used by every single-word lookup -- the
  // anchor word from a page click, an in-sentence word click, and a retry
  // that needs the dictionary redone). The dictionary result renders
  // immediately via fetchDictionary's own patchCard; only once it resolves
  // (successfully or not) does the AI call fire, so the model always has
  // whatever dictionary definition is available to compare against. A
  // phrase (ADR-008) has no dictionary entry and skips this entirely,
  // calling fetchContextTranslation directly instead. The whole chain is one
  // request with one token: the context half reuses it, and never starts
  // for a card that lost it while the dictionary half was in flight.
  const fetchWordContext = useCallback(
    (word: string, sentence: string, card: CardRef, counts: boolean) => {
      fetchDictionary(word, card, counts).then(({ current, chinese }) => {
        if (current) fetchContextTranslation(word, sentence, card, chinese)
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
  // scope -- EXCEPT the entry (and its highlighted anchor word)
  // render synchronously just before this runs, so in principle the user
  // could click that highlighted word (handleWordClick) in the same tick.
  // Guard against that race the same way the pre-ADR-023 version did: if a
  // card already exists, just reorder it -- never re-seed/re-fetch (would
  // double-charge the AI call for the same word).
  const seedAnchorWord = useCallback(
    (sentenceId: string, rawWord: string, sentence: string) => {
      const word = rawWord.toLowerCase()
      const key = wordCardKey(word)
      const existing = findCard(entriesRef.current, sentenceId, key)

      if (existing) {
        setEntries(prev =>
          reorderOrInsertCard(prev, sentenceId, key, () => existing)
        )
        return
      }

      const token = nextToken()
      setEntries(prev =>
        reorderOrInsertCard(prev, sentenceId, key, () => ({
          word,
          key,
          token,
          dictionaryStatus: 'loading',
          contextStatus: 'loading',
        }))
      )
      // The page's popover already counted this word's lookup.
      fetchWordContext(word, sentence, { sentenceId, key, token }, false)
    },
    [fetchWordContext, nextToken, setEntries]
  )

  // Lets a card stuck in an error state (e.g. session expiry) recover
  // without a full page reload, with a new token. Three cases, by what the
  // dictionary half is doing: a phrase card (dictionaryStatus 'none') has no
  // dictionary to redo, so just retry the AI call alone; a card whose
  // dictionary already loaded reuses that definition rather than re-running
  // getOneWord (no need to fetch it twice); anything else (dictionary
  // itself never resolved, e.g. also hit the same session expiry) redoes
  // the whole dictionary-first chain.
  const retryWordCard = useCallback(
    (sentenceId: string | undefined, card: WordCardData, sentence: string) => {
      const token = nextToken()
      const ref: CardRef = { sentenceId, key: card.key, token }
      const contextOnly =
        card.dictionaryStatus === 'none' || card.dictionaryStatus === 'loaded'
      setEntries(prev =>
        patchCard(prev, sentenceId, card.key, {
          token,
          contextStatus: 'loading',
          contextError: undefined,
          ...(contextOnly
            ? {}
            : { dictionaryStatus: 'loading', dictionaryError: undefined }),
        })
      )
      if (contextOnly) {
        fetchContextTranslation(
          card.word,
          sentence,
          ref,
          card.dictionaryStatus === 'loaded'
            ? card.dictionaryChinese
            : undefined
        )
        return
      }
      // A retry redoes a lookup, it is not a new one.
      fetchWordContext(card.word, sentence, ref, false)
    },
    [fetchContextTranslation, fetchWordContext, nextToken, setEntries]
  )

  // Whole-sentence translation for SentenceEntry `id`, filled in when it
  // resolves -- if the entry still carries `token`.
  const translateSentence = useCallback(
    (id: string, sentence: string, token: number) => {
      const patch = (fields: Partial<SentenceEntry>) =>
        setEntries(prev => patchSentence(prev, id, fields, token))

      sendMessageToBackground<BackgroundResponse>({
        type: 'translateSentence',
        sentence,
      } satisfies ContentMessage)
        .then(response => {
          if (response.success && response.chinese) {
            patch({ chinese: response.chinese, status: 'loaded' })
          } else {
            patch({
              errorMessage: response.error || 'Translation service unavailable',
              errorHttpStatus: response.status,
              status: 'error',
            })
          }
        })
        .catch(error => {
          console.error('SidePanel: sentence translation failed', error)
          patch({
            errorMessage: 'Translation service unavailable',
            errorHttpStatus: undefined,
            status: 'error',
          })
        })
    },
    [setEntries]
  )

  // A sentence context arrived (and it isn't a phrase context -- see the
  // effect below for that). The panel holds one card per sentence (ADR-023
  // Decision 8): a new sentence is prepended and translated; one already in
  // the history moves to the top with its translation and nested cards, and
  // is translated again only if it failed. Requests are never cancelled: a
  // loading card keeps its token and receives its response.
  useEffect(() => {
    if (!pendingContext || pendingContext.phrase) return

    const sentence = pendingContext.sentence
    const id = sentenceCardId(sentence)
    const anchorWord = pendingContext.word?.trim() || ''
    const clickedWord = anchorWord.toLowerCase()
    const anchorKey = wordCardKey(clickedWord)

    // pendingContext is an external event (a message from the content
    // script), so turning it into a new entry here is intended.
    const carriedStates = pendingContext.wordStates
    if (carriedStates) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setWordStates(prev => ({ ...prev, ...carriedStates }))
    }
    const existing = findSentence(entriesRef.current, id)
    const nestedAnchor = clickedWord
      ? existing?.words.find(w => w.key === anchorKey)
      : undefined
    // A nested card for the anchor already covers the page card; otherwise
    // the page card moves in (Decision 7).
    const pageCard = clickedWord
      ? adjacentPageCard(entriesRef.current, clickedWord)
      : undefined
    const absorbed = nestedAnchor ? undefined : pageCard
    const absorbedCard: WordCardData | undefined = absorbed && {
      word: absorbed.word,
      key: absorbed.key,
      token: nextToken(),
      pronunciation: absorbed.pronunciation,
      loadCount: absorbed.loadCount,
      dictionaryChinese: absorbed.dictionaryChinese,
      dictionaryStatus: absorbed.dictionaryStatus,
      contextStatus: 'loading',
    }
    const sentenceToken =
      !existing || existing.status === 'error' ? nextToken() : undefined

    setEntries(prev => {
      const rest = prev.filter(e => e !== pageCard)
      if (!existing) {
        return [
          {
            kind: 'sentence',
            id,
            token: sentenceToken,
            sentence,
            clickedWord,
            status: 'loading',
            chinese: '',
            errorMessage: '',
            errorHttpStatus: undefined,
            words: absorbedCard ? [absorbedCard] : [],
          },
          ...rest,
        ]
      }
      let next = patchSentence(moveSentenceToTop(rest, id), id, {
        ...(clickedWord ? { clickedWord } : {}),
        ...(sentenceToken === undefined
          ? {}
          : { token: sentenceToken, status: 'loading', errorMessage: '' }),
      })
      const anchorCard = nestedAnchor ?? absorbedCard
      if (anchorCard) {
        next = reorderOrInsertCard(next, id, anchorKey, () => anchorCard)
      }
      return next
    })

    // The anchor word's lookup is entirely independent of the
    // whole-sentence translation below -- neither should block the other --
    // so it fires here, not inside that request's .then(). An absorbed
    // page card already has its dictionary half, so only the in-sentence
    // meaning is fetched, fed that definition (dictionary-first). A nested
    // card for the anchor is only retried, and only if it failed.
    if (nestedAnchor) {
      if (
        nestedAnchor.contextStatus === 'error' ||
        nestedAnchor.dictionaryStatus === 'error'
      )
        retryWordCard(id, nestedAnchor, sentence)
    } else if (absorbedCard?.token !== undefined) {
      fetchContextTranslation(
        absorbedCard.word,
        sentence,
        { sentenceId: id, key: absorbedCard.key, token: absorbedCard.token },
        absorbedCard.dictionaryChinese
      )
    } else if (anchorWord) {
      seedAnchorWord(id, anchorWord, sentence)
    }

    if (sentenceToken !== undefined)
      translateSentence(id, sentence, sentenceToken)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingContext?.createdAt])

  // Phrase-in-context lookup (ADR-008/017): a multi-word selection never has a
  // dictionary entry (ECDICT/words only has single words), so it skips
  // getOneWord entirely and only ever gets an AI translateWordInContext
  // result -- rendered as a phrase card (dictionaryStatus 'none').
  // `sentenceId` undefined means a top-level card (a main-page drag-select,
  // ADR-008 -- there's no displayed sentence to nest it under); set means
  // nested into that SentenceEntry's own `words` (an in-panel drag-select,
  // ADR-017). Re-selecting a phrase already at that scope (a top-level one
  // also in the same sentence; ADR-023 Decision 8) just moves its card up --
  // no second AI call, no second charge -- unless it failed, which retries.
  const upsertPhraseCard = useCallback(
    (phrase: string, sentence: string, sentenceId: string | undefined) => {
      const key =
        sentenceId === undefined
          ? topLevelPhraseCardKey(phrase, sentence)
          : wordCardKey(phrase)
      const existing = findCard(entriesRef.current, sentenceId, key)
      if (existing) {
        setEntries(prev =>
          reorderOrInsertCard(prev, sentenceId, key, () => existing)
        )
        if (existing.contextStatus === 'error')
          retryWordCard(sentenceId, existing, sentence)
        return
      }
      const token = nextToken()
      setEntries(prev =>
        reorderOrInsertCard(prev, sentenceId, key, () => ({
          word: phrase,
          key,
          token,
          dictionaryStatus: 'none',
          contextStatus: 'loading',
          contextSentence: sentenceId === undefined ? sentence : undefined,
        }))
      )
      fetchContextTranslation(phrase, sentence, { sentenceId, key, token })
    },
    [fetchContextTranslation, nextToken, retryWordCard, setEntries]
  )

  // A phrase arriving via pendingContext (ADR-008: drag-selected on the web
  // page, already confirmed there) goes straight to a top-level card -- no
  // confirm button, unlike an in-panel drag-select (ADR-017), and no
  // SentenceEntry is created for it (the top status area stays reserved for
  // a genuine whole-sentence translation).
  useEffect(() => {
    if (pendingContext?.phrase) {
      // Same as above: reacting to an external pendingContext message.
      upsertPhraseCard(
        pendingContext.phrase,
        pendingContext.sentence,
        undefined
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingContext?.createdAt])

  // A card's Retry button. Recovers the sentence text from the owning
  // SentenceEntry when nested, or from the card's own `contextSentence` when
  // it's a top-level phrase card (ADR-023 -- there's no ambient "current
  // sentence" singleton anymore to fall back on).
  const handleRetryContextTranslation = useCallback(
    (sentenceId: string | undefined, key: string) => {
      const sentenceEntry = sentenceId
        ? findSentence(entries, sentenceId)
        : undefined
      const card = findCard(entries, sentenceId, key)
      const sentence = sentenceEntry?.sentence ?? card?.contextSentence
      if (!card || !sentence) return
      retryWordCard(sentenceId, card, sentence)
    },
    [entries, retryWordCard]
  )

  // The sentence's error row is the only one shown for a failure its words
  // share (WordCard `shownAbove`), so its Retry redoes those words as well.
  const handleRetrySentence = useCallback(
    (sentenceId: string) => {
      const entry = findSentence(entries, sentenceId)
      if (!entry) return
      const token = nextToken()
      setEntries(prev =>
        patchSentence(prev, sentenceId, {
          token,
          status: 'loading',
          errorMessage: '',
        })
      )
      translateSentence(entry.id, entry.sentence, token)
      for (const card of entry.words) {
        if (card.contextStatus === 'error' || card.dictionaryStatus === 'error')
          retryWordCard(entry.id, card, entry.sentence)
      }
    },
    [entries, translateSentence, retryWordCard, nextToken, setEntries]
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
      const key = wordCardKey(word)
      const existing = findCard(entries, sentenceId, key)
      if (existing) {
        setEntries(prev =>
          reorderOrInsertCard(prev, sentenceId, key, () => existing)
        )
        return
      }
      const token = nextToken()
      setEntries(prev =>
        reorderOrInsertCard(prev, sentenceId, key, () => ({
          word,
          key,
          token,
          dictionaryStatus: 'loading',
          contextStatus: 'loading',
        }))
      )
      // A click in the panel is a lookup of its own: count it.
      fetchWordContext(word, sentence, { sentenceId, key, token }, true)
    },
    [entries, fetchWordContext, nextToken, setEntries]
  )

  // Re-mark every sentence original after each render (ADR-053): the
  // anchor word and the review-stage underlines are Highlight API Ranges,
  // so they're rebuilt from `entries` against whatever text nodes React
  // just committed.
  const listRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const sentences: { node: Text; spans: SentenceHighlightSpans }[] = []
    for (const entry of entries) {
      if (entry.kind !== 'sentence') continue
      const el = listRef.current?.querySelector(
        `[data-entry-id="${CSS.escape(entry.id)}"]`
      )
      const node = el?.firstChild
      if (!(node instanceof Text)) continue
      sentences.push({
        node,
        spans: sentenceHighlightSpans(
          entry.sentence,
          entry.clickedWord,
          wordStates,
          underlinesOn
        ),
      })
    }
    applySentenceHighlights(sentences)
  }, [entries, wordStates, underlinesOn])

  // The guided hint only makes sense when the panel has shown nothing at
  // all yet.
  if (entries.length === 0) {
    return (
      <div className="px-4 pb-4 text-sm">
        {cleared && (
          <PanelToolbar label="Cleared">
            <button
              type="button"
              data-testid="sidepanel-undo-clear"
              onClick={() => {
                setEntries(cleared.entries)
                setExpandedWords(cleared.expandedWords)
                setCleared(null)
              }}
              className="font-medium text-brand hover:text-brand/80"
            >
              Undo
            </button>
          </PanelToolbar>
        )}
        <div
          className={`text-muted-foreground ${cleared ? '' : 'pt-4'}`}
          data-testid="sidepanel-empty-state"
        >
          Click any highlighted word in the page text, then click the
          sentence-translation icon in the popup. The full English sentence and
          its Chinese translation will appear here.
        </div>
      </div>
    )
  }

  return (
    <div ref={listRef} className="px-4 pb-4 text-sm">
      {/* Top-level entries only: a sentence's nested words belong to it. */}
      <PanelToolbar label={`History · ${entries.length}`}>
        <button
          type="button"
          data-testid="sidepanel-clear-all"
          onClick={() => {
            setCleared({ entries, expandedWords })
            setEntries([])
            setExpandedWords(new Set())
          }}
          className="hover:text-destructive"
        >
          Clear
        </button>
      </PanelToolbar>

      <div className="space-y-3">
        {entries.map(entry =>
          entry.kind === 'sentence' ? (
            <SentenceBlock
              key={entry.id}
              entry={entry}
              expandedWords={expandedWords}
              onToggleExpand={toggleExpanded}
              onWordClick={(sentenceId, sentence, word) =>
                handleWordClick(word, sentence, sentenceId)
              }
              onPhraseConfirm={(sentenceId, sentence, phrase) =>
                upsertPhraseCard(phrase, sentence, sentenceId)
              }
              onRemoveWord={handleRemoveCard}
              onRetryContext={handleRetryContextTranslation}
              onRetrySentence={handleRetrySentence}
            />
          ) : (
            <WordCard
              key={entry.key}
              card={entry}
              expanded={expandedWords.has(panelCardKey(undefined, entry.key))}
              onToggleExpand={() =>
                toggleExpanded(panelCardKey(undefined, entry.key))
              }
              onRemove={() => handleRemoveCard(undefined, entry.key)}
              onRetryContext={() =>
                handleRetryContextTranslation(undefined, entry.key)
              }
            />
          )
        )}
      </div>
    </div>
  )
}

export default function SidePanel() {
  return <SidePanelContent />
}
