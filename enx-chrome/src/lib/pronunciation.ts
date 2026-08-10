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

  const audio = new Audio(YOUDAO_AUDIO_URL(word))
  audio.addEventListener('error', () => speakWithBrowserTts(word), { once: true })
  audio.play().catch(() => speakWithBrowserTts(word))
}
