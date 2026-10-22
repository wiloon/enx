import { initialsOf, joinDateLabel } from '../accountProfile'

describe('initialsOf', () => {
  it.each([
    ['Alice Smith', 'alice@example.com', 'AS'],
    ['alice', 'alice@example.com', 'A'],
    ['  Mary  Jane   Watson ', 'mj@example.com', 'MW'],
    ['', 'bob@example.com', 'B'],
    ['   ', ' carol@example.com', 'C'],
    ['李雷', 'li@example.com', '李'],
    ['', '', ''],
  ])('%j / %j → %j', (name, email, initials) => {
    expect(initialsOf(name, email)).toBe(initials)
  })
})

describe('joinDateLabel', () => {
  it('reads the RFC 3339 join date as a calendar date', () => {
    expect(joinDateLabel('2026-03-04T10:00:00Z')).toBe('March 4, 2026')
  })

  it('is null for a missing or unreadable date', () => {
    expect(joinDateLabel('')).toBeNull()
    expect(joinDateLabel('not a date')).toBeNull()
  })
})
