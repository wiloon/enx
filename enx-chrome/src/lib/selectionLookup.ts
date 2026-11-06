// Where a text selection is not looked up (#664). Unlike click lookup,
// selection lookup ignores the tag exclusions (<a>, <code>, ...): selecting is
// how a word there gets looked up at all.

export const EDITABLE_REGION_SELECTOR =
  '[contenteditable]:not([contenteditable="false"])'

// True when any of `nodes` sits in an editable region (on every adapter) or
// in one of the adapter's lookupExcludedSelectors.
export const isSelectionLookupExcluded = (
  nodes: readonly (Node | null)[],
  adapterExclusions: readonly string[] = []
): boolean => {
  const selector = [EDITABLE_REGION_SELECTOR, ...adapterExclusions].join(', ')
  return nodes.some(node => {
    const element = node instanceof Element ? node : node?.parentElement
    return element?.closest(selector) != null
  })
}
