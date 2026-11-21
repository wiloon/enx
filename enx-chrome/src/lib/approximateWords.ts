/**
 * Estimated word counts for display (ADR-028 Decision 8 / ADR-052 Decision 1).
 * Same rule as enx-ui `approximateWords`: the measurement is approximate, so
 * the UI must not imply a precise total.
 */
export function approximateWords(words: number): string {
  if (words <= 0) return '0'
  if (words < 100) return '<100'
  const magnitude = words < 10_000 ? 100 : 1_000
  return (Math.round(words / magnitude) * magnitude).toLocaleString('en-US')
}
