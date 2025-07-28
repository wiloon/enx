import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import { User } from '@/types'

export const userAtom = atomWithStorage<User | null>('enx-user', null)

export const sessionIdAtom = atomWithStorage<string>('enx-session-id', '')

export const isAuthenticatedAtom = atom(
  (get) => {
    const user = get(userAtom)
    const sessionId = get(sessionIdAtom)
    return !!(user && sessionId && user.isLoggedIn)
  }
)

export const isLoadingAtom = atom(false)