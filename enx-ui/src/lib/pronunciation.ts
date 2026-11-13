// A copy of enx-chrome/src/lib/pronunciation.ts, so a word sounds the same in
// the extension and on the web. enx-ui's image builds from enx-ui/ alone, so it
// can't import the extension's file; change both together.
//
// Words are spoken by the browser's own speech synthesis (Web Speech API), so
// no word leaves the browser for a third-party audio service.

const isLang = (voice: SpeechSynthesisVoice, pattern: RegExp) =>
  pattern.test(voice.lang.replace('_', '-'))

export function pickEnglishVoice(
  voices: readonly SpeechSynthesisVoice[]
): SpeechSynthesisVoice | undefined {
  return (
    voices.find((voice) => isLang(voice, /^en-US$/i)) ??
    voices.find((voice) => isLang(voice, /^en(-|$)/i))
  )
}

export function playPronunciation(word: string): void {
  if (!word) return
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
  const synth = window.speechSynthesis

  // Voices can load after the first call ('voiceschanged'), so read the list
  // every time. While it is still empty, let the browser pick from the lang.
  const voices = synth.getVoices()
  const voice = pickEnglishVoice(voices)
  if (voices.length > 0 && !voice) return

  const utterance = new SpeechSynthesisUtterance(word)
  utterance.lang = 'en-US'
  if (voice) utterance.voice = voice

  // Interrupt the word still speaking instead of queueing behind it.
  synth.cancel()
  synth.speak(utterance)
}
