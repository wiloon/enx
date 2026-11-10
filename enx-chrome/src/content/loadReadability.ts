// ADR-077 decision 2: Readability is its own chunk, fetched only when layer 6
// passes its JSON-LD gate, never part of the always-loaded content script.
export const loadReadability = () =>
  import('@mozilla/readability').then(module => module.Readability)
