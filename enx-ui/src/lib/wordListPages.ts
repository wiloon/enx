import type { WordListEntry, WordListStatus } from '@/types'

// The loaded pages of one Word List view (a filter + sort + search), as the
// page keeps them between requests.
export interface LoadedWordList {
  pages: { total: number; words: WordListEntry[] }[]
}

const has = (list: LoadedWordList, english: string) =>
  list.pages.some((p) => p.words.some((w) => w.english === english))

// The view without the word: removed from the Word List, or no longer
// matching the view's filter. A view that never showed it is unchanged.
export function withoutWord<T extends LoadedWordList>(
  list: T,
  english: string
): T {
  if (!has(list, english)) return list
  return {
    ...list,
    pages: list.pages.map((p) => ({
      total: p.total - 1,
      words: p.words.filter((w) => w.english !== english),
    })),
  }
}

// The view after the word was marked known (or learning again): All keeps it
// and updates its badge; Learning or Known drops it once it no longer
// matches. A word that newly matches a view is not added here -- the view
// picks it up the next time it is fetched.
export function withKnown<T extends LoadedWordList>(
  list: T,
  status: WordListStatus,
  english: string,
  known: boolean
): T {
  if (status === 'learning' && known) return withoutWord(list, english)
  if (status === 'known' && !known) return withoutWord(list, english)
  if (!has(list, english)) return list
  return {
    ...list,
    pages: list.pages.map((p) => ({
      ...p,
      words: p.words.map((w) => (w.english === english ? { ...w, known } : w)),
    })),
  }
}
