// When the word popover and the side panel offer the speaker (#557, ADR-098).
// Playback needs only the spelling, never a phonetic, so every single word
// gets the speaker whatever its definition (Chinese, English, AI or a miss).
// A lookup still loading or one that failed, and a phrase, do not.

import type { WordCardData } from '@/lib/panelHistory'
import type { WordData } from '@/types'

const isSingleWord = (english: string): boolean =>
  !!english.trim() && !/\s/.test(english.trim())

export const popoverHasSpeaker = ({
  word,
  isTranslating,
  error,
}: {
  word: WordData | null
  isTranslating: boolean
  error: string | null
}): boolean =>
  !isTranslating && !error && !!word && isSingleWord(word.English)

export const cardHasSpeaker = (
  card: Pick<WordCardData, 'word' | 'dictionaryStatus' | 'dictionaryChinese'>
): boolean =>
  card.dictionaryStatus === 'loaded' && !!card.word && !!card.dictionaryChinese
