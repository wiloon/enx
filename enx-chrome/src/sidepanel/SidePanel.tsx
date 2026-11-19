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
import {
  PanelHistorySession,
  type CardRequest,
} from '@/lib/panelHistorySession'
import {
  chromePanelHistoryDeps,
  createPanelHistoryStore,
  panelHistoryKey,
  type CombinedPlan,
  type CombinedResponse,
  type PlannedRequest,
  type StoredCleared,
  type StoredPanelHistory,
  type TransactionOutcome,
} from '@/lib/panelHistoryStore'
import { runDictionaryLookup } from '@/lib/dictionaryLookup'
import { createAccountScope } from '@/lib/accountSession'
import { isLookupQuotaExceeded } from '@/lib/rateLimit'
import { config } from '@/config/env'
import LoadingSkeleton from '@/components/LoadingSkeleton'
import SignedOutNotice from '@/components/SignedOutNotice'
import {
  isSignedOutFailure,
  isUnverifiedFailure,
  SESSION_UNVERIFIED_MESSAGE,
  SIGNED_OUT_MESSAGE,
} from '@/lib/signedOut'
import {
  ACCOUNT_CHANGED_MESSAGE,
  createPanelAccountFence,
  freshAtDelivery,
  isAccountInvalidatedMessage,
  isSessionFailure,
  type PanelAccountFreshness,
} from '@/lib/panelAccountFence'
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
  PANEL_REQUEST_TIMEOUT_MS,
  earliestLoadingStartedAt,
  panelCardKey,
  patchCard,
  patchSentence,
  supersedeSessionRows,
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

// A signed-out row's Sign in: the ADR-020 web sign-in, back to the article tab.
const openWebSignIn = () => {
  void chrome.runtime.sendMessage({ action: 'openWebSignIn' })
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
  onRetryDictionary,
  shownAbove,
  nested = false,
}: {
  card: WordCardData
  expanded: boolean
  onToggleExpand: () => void
  onRemove: () => void
  onRetryContext: () => void
  // Retry on an unverified dictionary row (#686).
  onRetryDictionary: () => void
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
      ? card.contextSessionExpired
        ? SIGNED_OUT_MESSAGE
        : card.contextSessionUnverified
          ? SESSION_UNVERIFIED_MESSAGE
          : contextErrorDisplay(card.contextError, card.contextErrorHttpStatus)
      : undefined
  const quotaExceeded = isLookupQuotaExceeded({
    status: card.dictionaryErrorHttpStatus,
    code: card.dictionaryErrorCode,
  })
  const dictionaryErrorText =
    card.dictionaryStatus === 'error'
      ? card.dictionarySessionExpired
        ? SIGNED_OUT_MESSAGE
        : card.dictionarySessionUnverified
          ? SESSION_UNVERIFIED_MESSAGE
          : quotaExceeded
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
      {showContextError && card.contextSessionExpired && (
        <SignedOutNotice
          testId={`sidepanel-context-signed-out-${card.word}`}
          onSignIn={openWebSignIn}
          className="text-xs px-2 py-1 mt-2"
        />
      )}
      {showContextError && card.contextSessionUnverified && (
        <SignedOutNotice
          testId={`sidepanel-context-unverified-${card.word}`}
          message={SESSION_UNVERIFIED_MESSAGE}
          onRetry={onRetryContext}
          onSignIn={openWebSignIn}
          className="text-xs px-2 py-1 mt-2"
        />
      )}
      {showContextError &&
        !card.contextSessionExpired &&
        !card.contextSessionUnverified && (
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
      {showDictionaryError && card.dictionarySessionExpired && (
        <SignedOutNotice
          testId={`sidepanel-dictionary-signed-out-${card.word}`}
          onSignIn={openWebSignIn}
          className="text-xs px-2 py-1 mt-2"
        />
      )}
      {showDictionaryError && card.dictionarySessionUnverified && (
        <SignedOutNotice
          testId={`sidepanel-dictionary-unverified-${card.word}`}
          message={SESSION_UNVERIFIED_MESSAGE}
          onRetry={onRetryDictionary}
          onSignIn={openWebSignIn}
          className="text-xs px-2 py-1 mt-2"
        />
      )}
      {showDictionaryError &&
        !card.dictionarySessionExpired &&
        !card.dictionarySessionUnverified && (
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
  onRetryDictionary,
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
  onRetryDictionary: (sentenceId: string, key: string) => void
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
      ? entry.sessionExpired
        ? SIGNED_OUT_MESSAGE
        : entry.sessionUnverified
          ? SESSION_UNVERIFIED_MESSAGE
          : contextErrorDisplay(entry.errorMessage, entry.errorHttpStatus)
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
        {entry.status === 'error' && entry.sessionExpired && (
          <SignedOutNotice
            testId="sidepanel-signed-out"
            onSignIn={openWebSignIn}
            className="px-2 py-1"
          />
        )}
        {entry.status === 'error' && entry.sessionUnverified && (
          <SignedOutNotice
            testId="sidepanel-unverified"
            message={SESSION_UNVERIFIED_MESSAGE}
            onRetry={() => onRetrySentence(entry.id)}
            onSignIn={openWebSignIn}
            className="px-2 py-1"
          />
        )}
        {entry.status === 'error' &&
          !entry.sessionExpired &&
          !entry.sessionUnverified && (
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
              onRetryDictionary={() => onRetryDictionary(entry.id, card.key)}
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
  const [store] = useState(() =>
    createPanelHistoryStore(chromePanelHistoryDeps())
  )
  // whenVisible / paused follow-ups only; the card list lives in storage.
  const [history] = useState(() => new PanelHistorySession())
  const [entries, setEntriesState] = useState<PanelEntry[]>([])
  const [cleared, setCleared] = useState<StoredCleared | null>(null)
  // Clear's expandedWords are panel-local (not stored); restored on Undo here.
  const clearedExpandedRef = useRef<Set<string> | null>(null)
  const publishRef = useRef<(state: StoredPanelHistory) => void>(() => {})
  const dispatchPlanRef = useRef<(plan: PlannedRequest[]) => void>(() => {})

  const publish = useCallback(
    (state: StoredPanelHistory) => {
      history.mirrorFromStore(state.entries, state.cleared)
      setEntriesState(state.entries)
      setCleared(state.cleared)
    },
    [history]
  )
  useEffect(() => {
    publishRef.current = publish
  }, [publish])

  // Timeout sweep timer (ADR-090 Decision 5): fires for the earliest loading
  // card; the sweep itself runs in the store transaction.
  const sweepAt = useMemo(() => {
    const startedAt = earliestLoadingStartedAt(entries)
    return startedAt === undefined
      ? undefined
      : startedAt + PANEL_REQUEST_TIMEOUT_MS
  }, [entries])
  useEffect(() => {
    if (tabId === undefined || sweepAt === undefined) return
    const timer = setTimeout(
      () => {
        void store.sweep(tabId).then(result => publishRef.current(result.state))
      },
      Math.max(0, sweepAt - Date.now())
    )
    return () => clearTimeout(timer)
  }, [tabId, sweepAt, store])

  // Cards whose (often verbose) dictionary meaning the user has expanded past
  // the default 3-line clamp, by panelCardKey.
  const [expandedWords, setExpandedWords] = useState<Set<string>>(new Set())
  // Undo window follows storage expiresAt (ADR-090 Decision 7).
  const clearGeneration = cleared?.generation
  const clearExpiresAt = cleared?.expiresAt
  useEffect(() => {
    if (tabId === undefined || clearGeneration === undefined) return
    if (clearExpiresAt === undefined) return
    const delay = Math.max(0, clearExpiresAt - Date.now())
    const timer = setTimeout(() => {
      void store
        .discardClearedGeneration(tabId, clearGeneration)
        .then(result => {
          if (result.committed) publishRef.current(result.state)
        })
    }, delay)
    return () => clearTimeout(timer)
  }, [tabId, clearGeneration, clearExpiresAt, store])

  // What the panel knows about each word's review stage, keyed by
  // lower-cased word like the page's wordCache (ADR-053 Decision 3). Drives
  // the underlines in every sentence original.
  const [wordStates, setWordStates] = useState<Record<string, WordData>>({})
  const wordStatesRef = useRef(wordStates)
  useEffect(() => {
    wordStatesRef.current = wordStates
  }, [wordStates])
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

  // Persist a response write; a failed write leaves the card loading until
  // the 120 s timeout turns it into a Retry error (ADR-090 Decision 5).
  const patchEntries = useCallback(
    async (update: (prev: PanelEntry[]) => PanelEntry[]) => {
      if (tabId === undefined) return
      const result = await store.patchEntries(tabId, update)
      publish(result.state)
    },
    [tabId, store, publish]
  )

  // #236: a signed-out or unverified (#686) response or row is obsolete once
  // a signed-in account takes over. Listens only, like the listener above.
  const [accountFence] = useState(createPanelAccountFence)
  const [lookupScope] = useState(createAccountScope)
  useEffect(() => {
    const listener = (message: unknown) => {
      if (!isAccountInvalidatedMessage(message)) return
      accountFence.record(message.cause)
      lookupScope.clear()
      if (message.cause === 'switched') {
        void patchEntries(prev =>
          supersedeSessionRows(prev, ACCOUNT_CHANGED_MESSAGE)
        )
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [accountFence, lookupScope, patchEntries])

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
  // otherwise, so a long reading session accumulates noise).
  const handleRemoveCard = useCallback(
    (sentenceId: string | undefined, key: string) => {
      if (tabId === undefined) return
      void store.removeCard(tabId, sentenceId, key).then(result => {
        if (result.committed) publish(result.state)
      })
      const cardKey = panelCardKey(sentenceId, key)
      setExpandedWords(prev => {
        if (!prev.has(cardKey)) return prev
        const next = new Set(prev)
        next.delete(cardKey)
        return next
      })
    },
    [tabId, store, publish]
  )

  const claimSentenceEvent = useCallback(
    async (event: PendingSentenceContext) => {
      if (tabId === undefined || !event.eventId) return
      const carriedStates = event.wordStates
      if (carriedStates) {
        wordStatesRef.current = { ...wordStatesRef.current, ...carriedStates }
        setWordStates(prev => ({ ...prev, ...carriedStates }))
      }
      const result = await store.claimSentenceEvent(tabId, {
        eventId: event.eventId,
        sentence: event.sentence,
        word: event.word,
        phrase: event.phrase,
        wordStates: event.wordStates,
      })
      if (!result.committed) return
      publish(result.state)
      dispatchPlanRef.current(result.plan)
    },
    [tabId, store, publish]
  )

  const claimPageWordEvent = useCallback(
    async (lookup: LatestPageWordLookup) => {
      if (tabId === undefined || !lookup.eventId) return
      const word = wordKey(lookup.word)
      setWordStates(prev => ({ ...prev, [word]: lookup.ecp }))
      const result = await store.claimPageWordEvent(tabId, {
        eventId: lookup.eventId,
        word: lookup.word,
        ecp: lookup.ecp,
      })
      if (!result.committed) return
      publish(result.state)
    },
    [tabId, store, publish]
  )

  // History key + page events: mount read, then subscribe (ADR-090 / ADR-050).
  useEffect(() => {
    if (tabId === undefined) return
    const historyKey = panelHistoryKey(tabId)
    const sentenceKey = pendingSentenceKey(tabId)
    const pageWordKey = latestPageWordKey(tabId)
    let cancelled = false

    const listener = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string
    ) => {
      if (areaName !== 'session') return
      const historyChange = changes[historyKey]
      if (historyChange?.newValue) {
        publishRef.current(historyChange.newValue as StoredPanelHistory)
      }
      const sentenceChange = changes[sentenceKey]
      if (sentenceChange?.newValue) {
        void claimSentenceEvent(
          sentenceChange.newValue as PendingSentenceContext
        )
      }
      const pageWordChange = changes[pageWordKey]
      if (pageWordChange?.newValue) {
        void claimPageWordEvent(pageWordChange.newValue as LatestPageWordLookup)
      }
    }
    chrome.storage.onChanged.addListener(listener)

    void (async () => {
      // Mount sweep: timed-out cards become Retry errors (Decision 5).
      const swept = await store.sweep(tabId)
      if (cancelled) return
      publish(swept.state)

      const [sentenceResult, wordResult] = await Promise.all([
        chrome.storage.session.get(sentenceKey),
        chrome.storage.session.get(pageWordKey),
      ])
      if (cancelled) return
      const sentence = sentenceResult[sentenceKey] as
        PendingSentenceContext | undefined
      const word = wordResult[pageWordKey] as LatestPageWordLookup | undefined
      const ordered: Array<
        | { kind: 'sentence'; event: PendingSentenceContext }
        | { kind: 'pageWord'; event: LatestPageWordLookup }
      > = []
      if (sentence) ordered.push({ kind: 'sentence', event: sentence })
      if (word) ordered.push({ kind: 'pageWord', event: word })
      ordered.sort((a, b) => a.event.createdAt - b.event.createdAt)
      for (const item of ordered) {
        if (cancelled) return
        if (item.kind === 'sentence') await claimSentenceEvent(item.event)
        else await claimPageWordEvent(item.event)
      }
    })()

    return () => {
      cancelled = true
      chrome.storage.onChanged.removeListener(listener)
    }
  }, [tabId, store, publish, claimSentenceEvent, claimPageWordEvent])

  // Ask the worker at delivery: its account fence advances before its
  // asynchronous invalidation notification can reach this panel.
  const checkAccountFreshness = async (response: BackgroundResponse) => {
    if (!isSessionFailure(response)) return response
    const freshness = await sendMessageToBackground<
      PanelAccountFreshness | undefined
    >({
      type: 'panelAccountFreshness',
    })
    return freshAtDelivery(response, freshness)
  }

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
      card: CardRequest,
      dictionaryChinese?: string
    ) => {
      const patch = (fields: Partial<WordCardData>) =>
        void patchEntries(prev =>
          patchCard(prev, card.sentenceId, card.key, fields, card.token)
        )
      const current = accountFence.capture()
      sendMessageToBackground<BackgroundResponse>({
        type: 'translateWordInContext',
        word,
        sentence,
        dictionaryChinese,
      } satisfies ContentMessage)
        .then(checkAccountFreshness)
        .then(delivered => {
          const response = current(delivered)
          const resolved = response.success && response.chinese
          patch({
            contextChinese: resolved ? response.chinese : undefined,
            contextWhy: resolved ? response.why || undefined : undefined,
            contextError: resolved
              ? undefined
              : response.error || 'Translation failed',
            contextErrorHttpStatus: resolved ? undefined : response.status,
            contextSessionExpired: isSignedOutFailure(response),
            contextSessionUnverified: isUnverifiedFailure(response),
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
            contextSessionExpired: false,
            contextSessionUnverified: false,
          })
        })
    },
    [accountFence, patchEntries]
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
  // must not count it again. A cleared card pauses until Undo; expiry or
  // a new lookup discards its response. Removed/recreated cards fail the
  // token check and resolve `current: false`, stopping the chain.
  const fetchDictionary = useCallback(
    (
      word: string,
      card: CardRequest,
      counts: boolean
    ): Promise<{ current: boolean; chinese?: string }> => {
      const patch = (fields: Partial<WordCardData>) =>
        void patchEntries(prev =>
          patchCard(prev, card.sentenceId, card.key, fields, card.token)
        )
      const current = accountFence.capture()
      const isActive = lookupScope.capture()
      // A refused count leaves the definition on the card above its notice.
      const showFailure = (response: BackgroundResponse) =>
        patch({
          dictionaryStatus: 'error',
          dictionaryError: response.error || 'Dictionary lookup failed',
          dictionaryErrorHttpStatus: response.status,
          dictionaryErrorCode: response.code,
          dictionarySessionExpired: isSignedOutFailure(response),
          dictionarySessionUnverified: isUnverifiedFailure(response),
        })
      return sendMessageToBackground<BackgroundResponse>({
        type: 'getOneWord',
        word,
      } satisfies ContentMessage)
        .then(checkAccountFreshness)
        .then(delivered =>
          history.whenVisible(card, async () => {
            const response = current(delivered)
            // The context call starts once there is a definition (or none),
            // without waiting for the count POST.
            let shown!: (chinese?: string) => void
            const definitionShown = new Promise<string | undefined>(resolve => {
              shown = resolve
            })
            const lookup = runDictionaryLookup(
              word,
              { counts, state: wordStatesRef.current[wordKey(word)] },
              {
                get: async (word, refresh) => {
                  if (!refresh) return response
                  const fresh = await history.whenVisible(card, () =>
                    sendMessageToBackground<BackgroundResponse>({
                      type: 'getOneWord',
                      word,
                      refresh,
                    }).then(checkAccountFreshness)
                  )
                  // A clear during recovery pauses the next POST as well.
                  return (
                    (await history.whenVisible(card, () =>
                      current(fresh ?? { success: false })
                    )) ?? { success: false }
                  )
                },
                record: wordId =>
                  sendMessageToBackground<BackgroundResponse>({
                    type: 'recordWordLookup',
                    wordId,
                  })
                    .then(checkAccountFreshness)
                    .then(current),
                isActive,
                isCurrent: () => true,
                onDefinition: ecp => {
                  patch({
                    pronunciation: ecp.Pronunciation,
                    dictionaryChinese: ecp.Chinese,
                    loadCount: ecp.LoadCount,
                    dictionaryStatus: 'loaded',
                    dictionaryError: undefined,
                    dictionaryErrorHttpStatus: undefined,
                    dictionaryErrorCode: undefined,
                    dictionarySessionExpired: false,
                    dictionarySessionUnverified: false,
                  })
                  if (!counts && ecp.LoadCount !== undefined)
                    recordWordLookup(word, ecp)
                  shown(ecp.Chinese)
                },
                onCounted: ecp => recordWordLookup(word, ecp),
                onFailure: response => {
                  showFailure(response)
                  shown()
                },
                onRecordFailure: showFailure,
              }
            )
            const chinese = await Promise.race([
              definitionShown,
              lookup.then(data => data?.Chinese),
            ])
            return { current: true, chinese }
          })
        )
        .catch(() =>
          history.whenVisible(card, () => {
            patch({
              dictionaryStatus: 'error',
              dictionaryError: 'Dictionary lookup failed',
              dictionaryErrorHttpStatus: undefined,
              dictionaryErrorCode: undefined,
              dictionarySessionExpired: false,
              dictionarySessionUnverified: false,
            })
            return { current: true }
          })
        )
        .then(result => result ?? { current: false })
    },
    [accountFence, lookupScope, recordWordLookup, history, patchEntries]
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
    (word: string, sentence: string, card: CardRequest, counts: boolean) => {
      fetchDictionary(word, card, counts).then(({ current, chinese }) => {
        if (current) {
          // The context request re-records the card's startedAt as it is
          // sent (the 120 s runs from this request, not the dictionary one).
          void history.whenVisible(card, async () => {
            if (tabId === undefined) return
            const committed = await store.markContextSent(
              tabId,
              card.sentenceId,
              card.key,
              card.token
            )
            if (committed)
              fetchContextTranslation(word, sentence, card, chinese)
          })
        }
      })
    },
    [fetchDictionary, fetchContextTranslation, history, store, tabId]
  )

  // Whole-sentence translation for SentenceEntry `id`, filled in when it
  // resolves -- if the entry still carries `token`.
  const translateSentence = useCallback(
    (id: string, sentence: string, token: number) => {
      const patch = (fields: Partial<SentenceEntry>) =>
        void patchEntries(prev => patchSentence(prev, id, fields, token))

      const current = accountFence.capture()
      sendMessageToBackground<BackgroundResponse>({
        type: 'translateSentence',
        sentence,
      } satisfies ContentMessage)
        .then(checkAccountFreshness)
        .then(delivered => {
          const response = current(delivered)
          if (response.success && response.chinese) {
            patch({
              chinese: response.chinese,
              status: 'loaded',
              sessionExpired: false,
              sessionUnverified: false,
            })
          } else {
            patch({
              errorMessage: response.error || 'Translation service unavailable',
              errorHttpStatus: response.status,
              sessionExpired: isSignedOutFailure(response),
              sessionUnverified: isUnverifiedFailure(response),
              status: 'error',
            })
          }
        })
        .catch(error => {
          console.error('SidePanel: sentence translation failed', error)
          patch({
            errorMessage: 'Translation service unavailable',
            errorHttpStatus: undefined,
            sessionExpired: false,
            sessionUnverified: false,
            status: 'error',
          })
        })
    },
    [accountFence, patchEntries]
  )

  // The sentence and the word cards it absorbed in one request (ADR-023
  // Decision 9). The store writes the result back to the sentence and to each
  // word under its own token; a word left without a gloss gets an individual
  // request (at once when visible, after Undo when only in the Clear stash).
  const translateSentenceWithWords = useCallback(
    (combined: CombinedPlan) => {
      const current = accountFence.capture()
      const isActive = lookupScope.capture()
      const failure = (response?: BackgroundResponse): CombinedResponse => ({
        success: false,
        error: response?.error || 'Translation service unavailable',
        status: response?.status,
        sessionExpired: response ? isSignedOutFailure(response) : false,
        sessionUnverified: response ? isUnverifiedFailure(response) : false,
      })
      const write = (response: CombinedResponse) => {
        if (tabId === undefined) return
        void store
          .applySentenceWithWords(tabId, combined, response)
          .then(result => {
            if (!result.committed) return
            for (const request of [...result.plan, ...result.deferred]) {
              if (request.type !== 'fetchContextTranslation') continue
              const dispatch = () => {
                if (!isActive()) return
                void store.dispatchContextFallback(
                  tabId,
                  request,
                  () => {
                    if (!isActive()) return
                    fetchContextTranslation(
                      request.word,
                      request.sentence,
                      request,
                      request.dictionaryChinese
                    )
                  },
                  state => {
                    history.mirrorFromStore(state.entries, state.cleared)
                    void history.whenVisible(request, dispatch)
                  }
                )
              }
              dispatch()
            }
          })
      }
      sendMessageToBackground<BackgroundResponse>({
        type: 'translateSentenceWithWords',
        sentence: combined.sentence,
        sentenceWords: combined.words.map(w => ({
          word: w.word,
          dictionaryChinese: w.dictionaryChinese,
        })),
      } satisfies ContentMessage)
        .then(checkAccountFreshness)
        .then(delivered => {
          const response = current(delivered)
          write(
            response.success && response.chinese
              ? {
                  success: true,
                  chinese: response.chinese,
                  words: response.words ?? [],
                }
              : failure(response)
          )
        })
        .catch(error => {
          console.error(
            'SidePanel: combined sentence translation failed',
            error
          )
          write(failure())
        })
    },
    [accountFence, lookupScope, store, tabId, history, fetchContextTranslation]
  )

  const dispatchPlan = useCallback(
    (plan: PlannedRequest[]) => {
      for (const req of plan) {
        if (req.type === 'translateSentence') {
          translateSentence(req.sentenceId, req.sentence, req.token)
        } else if (req.type === 'translateSentenceWithWords') {
          translateSentenceWithWords(req)
        } else if (req.type === 'fetchWordContext') {
          fetchWordContext(
            req.word,
            req.sentence,
            {
              sentenceId: req.sentenceId,
              key: req.key,
              token: req.token,
            },
            req.counts
          )
        } else if (req.type === 'fetchDictionary') {
          void fetchDictionary(
            req.word,
            { sentenceId: req.sentenceId, key: req.key, token: req.token },
            false
          )
        } else {
          fetchContextTranslation(
            req.word,
            req.sentence,
            {
              sentenceId: req.sentenceId,
              key: req.key,
              token: req.token,
            },
            req.dictionaryChinese
          )
        }
      }
    },
    [
      translateSentence,
      translateSentenceWithWords,
      fetchWordContext,
      fetchContextTranslation,
      fetchDictionary,
    ]
  )
  useEffect(() => {
    dispatchPlanRef.current = dispatchPlan
  }, [dispatchPlan])

  // Card actions: the store decides inside its lock (card still there, not
  // already loading, token allocation) and returns the plan to send; this
  // component only wires the click and dispatches what was committed.
  const runAction = useCallback(
    (action: (id: number) => Promise<TransactionOutcome>) => {
      if (tabId === undefined) return
      void action(tabId).then(result => {
        if (!result.committed) return
        publish(result.state)
        dispatchPlan(result.plan)
      })
    },
    [tabId, publish, dispatchPlan]
  )

  const handleRetryContextTranslation = useCallback(
    (sentenceId: string | undefined, key: string) =>
      runAction(id => store.retryContext(id, sentenceId, key)),
    [runAction, store]
  )

  const handleRetryDictionary = useCallback(
    (sentenceId: string | undefined, key: string) =>
      runAction(id => store.retryDictionary(id, sentenceId, key)),
    [runAction, store]
  )

  // The sentence's error row is the only one shown for a failure its words
  // share (WordCard `shownAbove`), so its Retry redoes those words as well.
  const handleRetrySentence = useCallback(
    (sentenceId: string) =>
      runAction(id => store.retrySentence(id, sentenceId)),
    [runAction, store]
  )

  // Phrase-in-context lookup (ADR-008/017) and in-sentence word click
  // (ADR-017); see the store for the rules.
  const upsertPhraseCard = useCallback(
    (phrase: string, sentence: string, sentenceId: string | undefined) =>
      runAction(id => store.upsertPhrase(id, phrase, sentence, sentenceId)),
    [runAction, store]
  )

  const handleWordClick = useCallback(
    (rawWord: string, sentence: string, sentenceId: string) =>
      runAction(id => store.clickWord(id, rawWord, sentence, sentenceId)),
    [runAction, store]
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
                if (tabId === undefined) return
                void store.undo(tabId).then(result => {
                  if (!result.committed) return
                  publish(result.state)
                  if (clearedExpandedRef.current) {
                    setExpandedWords(clearedExpandedRef.current)
                    clearedExpandedRef.current = null
                  }
                })
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
            if (tabId === undefined) return
            clearedExpandedRef.current = new Set(expandedWords)
            void store.clear(tabId).then(result => {
              if (!result.committed) {
                clearedExpandedRef.current = null
                return
              }
              publish(result.state)
              setExpandedWords(new Set())
            })
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
              onRetryDictionary={handleRetryDictionary}
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
              onRetryDictionary={() =>
                handleRetryDictionary(undefined, entry.key)
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
