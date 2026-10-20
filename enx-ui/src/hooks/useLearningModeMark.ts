'use client'

import { useSyncExternalStore } from 'react'

// ADR-047 Decision 4a: the extension writes <html data-enx-learning="on">
// while learning mode is on in this tab, and removes it when it goes off.
const read = () =>
  document.documentElement.getAttribute('data-enx-learning') === 'on'

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-enx-learning'],
  })
  return () => observer.disconnect()
}

export function useLearningModeMark(): boolean {
  return useSyncExternalStore(subscribe, read, () => false)
}
