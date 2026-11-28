// Which English-English senses the word popover and /lookup show (ADR-098).
// The server may return up to 10; the surfaces keep at most 4, and at most
// 2 per part of speech, in the server's order.

export type Sense = {
  pos: string
  gloss: string
  example?: string
}

export const MAX_POPOVER_SENSES = 4
export const MAX_SENSES_PER_POS = 2
// The side panel's word card has more room than the popover (ADR-098).
export const MAX_PANEL_SENSES = 8

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

// One pronunciation in the popover and on /lookup: US IPA, else UK.
export const englishPronunciation = (word: {
  PronunciationUS?: string
  PronunciationUK?: string
}): string => word.PronunciationUS || word.PronunciationUK || ''
