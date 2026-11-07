// The Side Panel's history list (ADR-023) and the identity of its cards
// (ADR-023 Decision 8): no two sentence cards hold the same sentence, and no
// two word/phrase cards in one scope share a key. Every async response is
// written back by (sentenceId, key) and only while the card still carries
// the token of the request it is waiting on.

export type Status = 'idle' | 'loading' | 'loaded' | 'error'

export type FetchStatus = 'loading' | 'loaded' | 'error'

// Word click in the Side Panel renders as a card (spec §3.9): dictionary
// lookup (getOneWord) and AI contextual translation (translateWordInContext)
// each track their own status -- the card renders progressively, showing
// whichever half resolves first. 'none' means "not applicable". On
// contextStatus: cards created from a page-level word popover lookup
// (ADR-006) have no sentence context to translate against and so must never
// show the "翻译中..."/context text UI at all. On dictionaryStatus: phrase
// cards (ADR-008) -- a 2-5 word selection never has an ECDICT/words entry, so
// they skip the dictionary half entirely and only ever populate context*.
export interface WordCardData {
  // The spelling the card was created with; a reused card keeps it.
  word: string
  // Identity within its scope: wordCardKey or topLevelPhraseCardKey.
  key: string
  // The request this card is waiting on (a panel-wide counter).
  token?: number
  pronunciation?: string
  loadCount?: number
  dictionaryChinese?: string
  dictionaryStatus: FetchStatus | 'none'
  // Set when dictionaryStatus is 'error'. The status and code tell the
  // daily lookup quota (TASK-SPEC §4.2; rendered with an upgrade link) from
  // the request rate limit (ADR-060; the server's own message) -- both 429.
  dictionaryError?: string
  dictionaryErrorHttpStatus?: number
  dictionaryErrorCode?: string
  // The failure was a lost session (#236): the row offers Sign in.
  dictionarySessionExpired?: boolean
  // The failure was an unverified session (#686): Retry and Sign in.
  dictionarySessionUnverified?: boolean
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
  contextSessionExpired?: boolean
  contextSessionUnverified?: boolean
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
export interface SentenceEntry {
  kind: 'sentence'
  // sentenceCardId(sentence): one card per sentence in the whole history.
  id: string
  token?: number
  sentence: string
  // The word the user clicked on the page before opening the panel
  // (ADR-014), marked with the enx-sp-anchor highlight in the rendered
  // original (ADR-053). Empty for a
  // drag-selected sentence (ADR-007) -- no anchor word.
  clickedWord: string
  status: Status
  chinese: string
  errorMessage: string
  errorHttpStatus?: number
  sessionExpired?: boolean
  sessionUnverified?: boolean
  words: WordCardData[]
}

export type WordEntry = { kind: 'word' } & WordCardData

export type PanelEntry = WordEntry | SentenceEntry

export const normalizeCardText = (text: string): string =>
  text.trim().replace(/\s+/g, ' ').toLowerCase()

// cyrb53: a short, stable id, so `data-entry-id` selectors stay short.
const hash53 = (text: string): string => {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507)
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

export const sentenceCardId = (sentence: string): string =>
  `s-${hash53(normalizeCardText(sentence))}`

// A nested card of any kind, or a top-level word card from a page click.
export const wordCardKey = (word: string): string => normalizeCardText(word)

// A top-level phrase card: its in-context meaning belongs to the sentence it
// was selected in. Normalised text holds no newline, so this never equals a
// wordCardKey.
export const topLevelPhraseCardKey = (
  phrase: string,
  contextSentence: string
): string =>
  `${normalizeCardText(phrase)}\n${normalizeCardText(contextSentence)}`

// A card's identity across the whole panel, for state kept outside entries
// (which cards are expanded).
export const panelCardKey = (
  sentenceId: string | undefined,
  key: string
): string => `${sentenceId ?? ''}\n${key}`

// -- Pure helpers over PanelEntry[] -------------------------------------
// `sentenceId === undefined` targets the top-level word/phrase entries;
// `sentenceId` set targets that SentenceEntry's own nested `words`.

export const findSentence = (
  entries: PanelEntry[],
  sentenceId: string
): SentenceEntry | undefined =>
  entries.find(
    (e): e is SentenceEntry => e.kind === 'sentence' && e.id === sentenceId
  )

export const findCard = (
  entries: PanelEntry[],
  sentenceId: string | undefined,
  key: string
): WordCardData | undefined => {
  if (sentenceId === undefined) {
    return entries.find(
      (e): e is WordEntry => e.kind === 'word' && e.key === key
    )
  }
  return findSentence(entries, sentenceId)?.words.find(w => w.key === key)
}

const toFront = <T>(items: T[], index: number): T[] => [
  items[index],
  ...items.slice(0, index),
  ...items.slice(index + 1),
]

// Reorders the card to the front if `key` already exists at this scope
// (reusing its existing data, never re-fetching); otherwise inserts a new
// card built by `makeCard()` at the front.
export const reorderOrInsertCard = (
  entries: PanelEntry[],
  sentenceId: string | undefined,
  key: string,
  makeCard: () => WordCardData
): PanelEntry[] => {
  if (sentenceId === undefined) {
    const index = entries.findIndex(e => e.kind === 'word' && e.key === key)
    if (index !== -1) return toFront(entries, index)
    return [{ kind: 'word', ...makeCard() }, ...entries]
  }
  return entries.map(e => {
    if (e.kind !== 'sentence' || e.id !== sentenceId) return e
    const index = e.words.findIndex(w => w.key === key)
    if (index !== -1) return { ...e, words: toFront(e.words, index) }
    return { ...e, words: [makeCard(), ...e.words] }
  })
}

// A page popover lookup mirrored into the panel (ADR-006): it carries the
// popover's latest dictionary data, so a top-level card already holding the
// word takes that data as it moves to the front -- a miss the AI fallback
// later defined, or a newer lookup count. Nested cards are left alone.
export const upsertPageLookupCard = (
  entries: PanelEntry[],
  card: WordCardData
): PanelEntry[] => {
  const index = entries.findIndex(e => e.kind === 'word' && e.key === card.key)
  if (index === -1) return [{ kind: 'word', ...card }, ...entries]
  const moved = toFront(entries, index)
  return [{ ...moved[0], ...card } as WordEntry, ...moved.slice(1)]
}

// Merges `patch` into the card; with `token` given, only while the card
// still carries it (a response to the request that token started).
export const patchCard = (
  entries: PanelEntry[],
  sentenceId: string | undefined,
  key: string,
  patch: Partial<WordCardData>,
  token?: number
): PanelEntry[] => {
  const card = findCard(entries, sentenceId, key)
  if (!card || (token !== undefined && card.token !== token)) return entries
  if (sentenceId === undefined) {
    return entries.map(e => (e === card ? { ...e, ...patch } : e))
  }
  return entries.map(e =>
    e.kind === 'sentence' && e.id === sentenceId
      ? { ...e, words: e.words.map(w => (w === card ? { ...w, ...patch } : w)) }
      : e
  )
}

export const removeCard = (
  entries: PanelEntry[],
  sentenceId: string | undefined,
  key: string
): PanelEntry[] => {
  if (sentenceId === undefined) {
    return entries.filter(e => !(e.kind === 'word' && e.key === key))
  }
  return entries.map(e =>
    e.kind === 'sentence' && e.id === sentenceId
      ? { ...e, words: e.words.filter(w => w.key !== key) }
      : e
  )
}

// After a switch to a signed-in account (#236), no row offers Sign in: each
// signed-out or unverified (#686) row becomes an ordinary failure with
// `message`, and Retry where the row has one.
export const supersedeSessionRows = (
  entries: PanelEntry[],
  message: string
): PanelEntry[] => {
  const card = <C extends WordCardData>(c: C): C => {
    const context = c.contextSessionExpired || c.contextSessionUnverified
    const dictionary =
      c.dictionarySessionExpired || c.dictionarySessionUnverified
    return context || dictionary
      ? {
          ...c,
          ...(context && {
            contextSessionExpired: false,
            contextSessionUnverified: false,
            contextError: message,
            contextErrorHttpStatus: undefined,
          }),
          ...(dictionary && {
            dictionarySessionExpired: false,
            dictionarySessionUnverified: false,
            dictionaryError: message,
            dictionaryErrorHttpStatus: undefined,
            dictionaryErrorCode: undefined,
          }),
        }
      : c
  }
  return entries.map(e =>
    e.kind === 'word'
      ? card(e)
      : {
          ...e,
          ...((e.sessionExpired || e.sessionUnverified) && {
            sessionExpired: false,
            sessionUnverified: false,
            errorMessage: message,
            errorHttpStatus: undefined,
          }),
          words: e.words.map(card),
        }
  )
}

// Same token rule as patchCard, for the sentence card itself.
export const patchSentence = (
  entries: PanelEntry[],
  sentenceId: string,
  patch: Partial<SentenceEntry>,
  token?: number
): PanelEntry[] => {
  const entry = findSentence(entries, sentenceId)
  if (!entry || (token !== undefined && entry.token !== token)) return entries
  return entries.map(e => (e === entry ? { ...entry, ...patch } : e))
}

export const moveSentenceToTop = (
  entries: PanelEntry[],
  sentenceId: string
): PanelEntry[] => {
  const index = entries.findIndex(
    e => e.kind === 'sentence' && e.id === sentenceId
  )
  return index === -1 ? entries : toFront(entries, index)
}

// The top-level page-lookup card a sentence sent from `word` should absorb
// (ADR-023 Decision 7): the user clicked `word` on the page, then sent its
// sentence to the panel from the same popover, so the newest entry is that
// word's dictionary-only card. Only the very first entry counts -- an older
// lookup of the same word is its own history.
export const adjacentPageCard = (
  entries: PanelEntry[],
  word: string
): WordEntry | undefined => {
  const first = entries[0]
  if (
    first?.kind === 'word' &&
    first.key === wordCardKey(word) &&
    first.dictionaryStatus === 'loaded' &&
    first.contextStatus === 'none'
  )
    return first
  return undefined
}
