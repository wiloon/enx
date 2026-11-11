import type { WordData } from '@/types'

// Definition reads carry no user state; only the recording response supplies it.
export type LookupWord = Omit<WordData, 'LoadCount' | 'Known'> &
  Partial<Pick<WordData, 'LoadCount' | 'Known'>>
export type LookupAnswer =
  | { kind: 'result'; word: LookupWord; message?: string }
  | { kind: 'miss' | 'no-answer' }

export const lookupAnswer = (
  requested: string,
  data: unknown
): LookupAnswer => {
  const entry = Array.isArray(data) ? data[0] : undefined
  if (entry?.Status === 'not_found') return { kind: 'miss' }
  if (entry?.Status !== 'found') return { kind: 'no-answer' }
  return {
    kind: 'result',
    word: {
      Id: entry.Id ?? '',
      Key: requested,
      English: entry.English || requested,
      Pronunciation: entry.Pronunciation ?? '',
      Chinese: entry.Chinese ?? '',
      WordType: entry.WordType ?? 0,
      Source: entry.Source,
    },
  }
}

export const shownLookupSource = (
  source: string | undefined
): 'local' | 'ecdict' | null =>
  source === 'local' || source === 'ecdict' ? source : null
