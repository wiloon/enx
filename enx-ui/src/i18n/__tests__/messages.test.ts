import en from '../../../messages/en.json'
import zh from '../../../messages/zh.json'

// next-intl types the keys from en.json only, so nothing else notices a key
// missing from zh.json until a Chinese page shows a key name (ADR-096
// Decision 6). Leaves only: a key is its full dotted path.
function keyPaths(messages: object, prefix = ''): string[] {
  return Object.entries(messages).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return value !== null && typeof value === 'object'
      ? keyPaths(value, path)
      : [path]
  })
}

it('en.json and zh.json have exactly the same keys, nested keys included', () => {
  expect(keyPaths(zh).sort()).toEqual(keyPaths(en).sort())
})

it('has a non-empty message for every key in both languages', () => {
  for (const messages of [en, zh]) {
    const empty = keyPaths(messages).filter((path) => {
      const value = path
        .split('.')
        .reduce<unknown>(
          (node, key) => (node as Record<string, unknown>)[key],
          messages
        )
      return typeof value !== 'string' || value.trim() === ''
    })
    expect(empty).toEqual([])
  }
})
