import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import { User } from '@/types'

export const userAtom = atomWithStorage<User | null>('enx-user', null)

export const accessTokenAtom = atomWithStorage<string>('enx-access-token', '')

export const refreshTokenAtom = atomWithStorage<string>('enx-refresh-token', '')

export const isAuthenticatedAtom = atom((get) => {
  const user = get(userAtom)
  const accessToken = get(accessTokenAtom)
  return !!(user && accessToken && user.isLoggedIn)
})

export const isLoadingAtom = atom(false)
