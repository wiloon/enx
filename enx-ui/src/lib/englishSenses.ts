// Which English-English senses /lookup shows (ADR-098). Same rule as the
// extension popover: at most 4, at most 2 per part of speech, server order.

export type Sense = {
  pos: string
  gloss: string
  example?: string
}

export const MAX_POPOVER_SENSES = 4
export const MAX_SENSES_PER_POS = 2

export const selectPopoverSenses = (
  senses: readonly Sense[],
  max = MAX_POPOVER_SENSES,
  maxPerPos = MAX_SENSES_PER_POS
): Sense[] => {
  const counts = new Map<string, number>()
  const selected: Sense[] = []
  for (const sense of senses) {
    if (selected.length >= max) break
    const n = counts.get(sense.pos) ?? 0
    if (n >= maxPerPos) continue
    counts.set(sense.pos, n + 1)
    selected.push(sense)
  }
  return selected
}

export const englishPronunciation = (word: {
  PronunciationUS?: string
  PronunciationUK?: string
}): string => word.PronunciationUS || word.PronunciationUK || ''
