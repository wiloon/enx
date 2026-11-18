export interface DefinitionPart {
  text: string
  partOfSpeech: boolean
}

export function splitDefinition(text: string): DefinitionPart[] {
  const parts: DefinitionPart[] = []
  // Only labels at the start of a sense, never abbreviations inside prose.
  const labels =
    /(?<=^|[;；\n]\s*)(?:adj|adv|pron|prep|conj|interj|int|art|num|aux|vt|vi|v|n|a)\./g
  let offset = 0
  for (const match of text.matchAll(labels)) {
    if (match.index > offset) {
      parts.push({ text: text.slice(offset, match.index), partOfSpeech: false })
    }
    parts.push({ text: match[0], partOfSpeech: true })
    offset = match.index + match[0].length
  }
  if (offset < text.length) {
    parts.push({ text: text.slice(offset), partOfSpeech: false })
  }
  return parts
}
