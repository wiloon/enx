// How the signed-in account is shown in the account menu and on /account
// (#211).

const firstChar = (word: string) => Array.from(word)[0] ?? ''

// What the avatar shows without a picture: the first letters of the first and
// last words of the name, or the email's first letter when there is no name.
export function initialsOf(name: string, email: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return firstChar(email.trim()).toUpperCase()
  const first = firstChar(words[0])
  const last = words.length > 1 ? firstChar(words[words.length - 1]) : ''
  return (first + last).toUpperCase()
}

// "March 4, 2026" for the account's join date, or null when the API sent
// none it can read.
export function joinDateLabel(createdAt: string): string | null {
  if (!createdAt) return null
  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}
