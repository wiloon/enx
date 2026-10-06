// Learning mode is for English articles. A Chinese article often carries
// English terms (Kubernetes, API, ...), and highlighting those would turn a
// Chinese read into a vocabulary drill nobody asked for -- so an article
// body with more Chinese characters than the limit is skipped as a whole.
// The limit leaves room for an English article that glosses a name or a term
// in Chinese.

export const DEFAULT_HAN_CHAR_LIMIT = 20

const HAN_CHAR = /\p{Script=Han}/gu

export function countHanChars(text: string): number {
  return text.match(HAN_CHAR)?.length ?? 0
}

/** True when `text` holds more than `limit` Chinese characters. */
export function isChineseArticle(text: string, limit: number): boolean {
  return countHanChars(text) > limit
}

// Build-time VITE_HAN_CHAR_LIMIT: a non-negative integer; 0 skips an article
// on its first Chinese character. Anything else keeps the default.
export function parseHanCharLimit(raw: string | undefined): number {
  const value = raw?.trim()
  if (!value) return DEFAULT_HAN_CHAR_LIMIT
  if (/^\d+$/.test(value)) return Number(value)
  console.warn(
    `[ENX Config] Ignoring invalid VITE_HAN_CHAR_LIMIT "${raw}"; using ${DEFAULT_HAN_CHAR_LIMIT}`
  )
  return DEFAULT_HAN_CHAR_LIMIT
}
