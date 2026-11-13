// The dictionary a user opens to check a word against an authoritative source.
// The UI never names it, so switching dictionaries is a change here alone.
// Cambridge's search redirect lands on the entry and handles phrases, capitals
// and misses (a suggestions page).
const CAMBRIDGE_SEARCH =
  'https://dictionary.cambridge.org/search/direct/?datasetsearch=english-chinese-simplified&q='

export const externalDictionaryUrl = (word: string): string =>
  `${CAMBRIDGE_SEARCH}${encodeURIComponent(word)}`
