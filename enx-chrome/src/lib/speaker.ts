// When the word popover and the side panel offer the speaker (#557).
// Playback needs only the spelling, never a phonetic, so a defined word
// without one still gets the speaker. A lookup still loading or one that
// failed, a dictionary miss (no Chinese definition) and a phrase do not.

import type { WordCardData } from '@/lib/panelHistory'
import type { WordData } from '@/types'

export const popoverHasSpeaker = ({
  word,
  isTranslating,
  error,
}: {
  word: WordData | null
  isTranslating: boolean
  error: string | null
}): boolean => !isTranslating && !error && !!word?.English && !!word.Chinese

export const cardHasSpeaker = (
  card: Pick<WordCardData, 'word' | 'dictionaryStatus' | 'dictionaryChinese'>
): boolean =>
  card.dictionaryStatus === 'loaded' && !!card.word && !!card.dictionaryChinese
