// Youdao's dictvoice endpoint returns real human recordings and needs no API
// key, but it's an unofficial endpoint that can go down or rate-limit. The
// Web Speech API is the fallback: lower quality but built into the browser,
// so pronunciation playback never fully fails.
const YOUDAO_AUDIO_URL = (word: string) =>
  `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=2`

function speakWithBrowserTts(word: string): void {
  if (!('speechSynthesis' in window)) return
  const utterance = new SpeechSynthesisUtterance(word)
  utterance.lang = 'en-US'
  window.speechSynthesis.speak(utterance)
}

export function playPronunciation(word: string): void {
  if (!word) return

  // A failed Youdao request rejects the play() promise *and* fires the audio
  // element's 'error' event, so both fallback paths run and the browser TTS
  // speaks the word twice. Guard so the fallback fires at most once.
  let fellBack = false
  const fallBack = () => {
    if (fellBack) return
    fellBack = true
    speakWithBrowserTts(word)
  }

  const audio = new Audio(YOUDAO_AUDIO_URL(word))
  audio.addEventListener('error', fallBack, { once: true })
  audio.play().catch(fallBack)
}
