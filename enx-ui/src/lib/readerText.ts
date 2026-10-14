// How Reader turns plain text into an article (ADR-019): paragraphs split on
// blank lines; newlines inside a paragraph are kept (rendered with
// `white-space: pre-wrap`).
export function toParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
}
