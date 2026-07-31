import { createStore } from 'jotai'

// Content script runs in a JS context completely independent from
// popup.html/options.html, so it cannot share their <Provider>. This store is
// created once when the content script module loads and reused for every
// popup mount (showWordPopup() creates a new React root per click, but always
// against this same store) -- currentWordAtom/isTranslatingAtom/errorAtom are
// plain in-memory atoms with no chrome.storage persistence, so no hydrate step
// is needed here.
export const contentScriptStore = createStore()
