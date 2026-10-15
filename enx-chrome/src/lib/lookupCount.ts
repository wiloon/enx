// How a word's lookup count (LoadCount) is spelled out, for the hover title
// and screen readers. The word popover and the Side Panel card show it the
// same way: the repeat icon and the bare number, with this as the label.
export function lookupCountLabel(count: number): string {
  return `Looked up ${count} ${count === 1 ? 'time' : 'times'}`
}
