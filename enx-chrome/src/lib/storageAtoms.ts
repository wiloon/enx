import { atom } from 'jotai'
import { User } from '@/types'

// User atom with Chrome storage persistence
export const createUserAtom = () => {
  const defaultUser: User = {
    id: 0,
    username: '',
    email: '',
    isLoggedIn: false,
  }

  const baseAtom = atom(defaultUser)

  const userAtom = atom(
    get => get(baseAtom),
    async (_get, set, newValue: User) => {
      set(baseAtom, newValue)

      // Save to Chrome storage
      try {
        await chrome.storage.local.set({
          'enx-user': newValue,
          user: newValue, // Keep compatibility with background script
        })
        console.log('User state saved to storage:', newValue)
      } catch (error) {
        console.error('Failed to save user to storage:', error)
      }
    }
  )

  return userAtom
}

// ADR-015: session tokens are owned by Clerk (@clerk/chrome-extension), not
// stored by the extension. `createSessionAtom` / `sessionAtom` are gone.
