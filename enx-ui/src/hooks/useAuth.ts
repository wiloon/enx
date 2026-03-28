import { useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useAtom, useAtomValue } from 'jotai'
import {
  userAtom,
  accessTokenAtom,
  refreshTokenAtom,
  isLoadingAtom,
  isAuthenticatedAtom,
} from '@/store/authAtoms'
import { apiService } from '@/services/api'
import { beginCognitoSignIn, cognitoLogout, CognitoTokens } from '@/lib/cognito'

export const useAuth = () => {
  const [user, setUser] = useAtom(userAtom)
  const [accessToken, setAccessToken] = useAtom(accessTokenAtom)
  const [refreshToken, setRefreshToken] = useAtom(refreshTokenAtom)
  const [isLoading, setIsLoading] = useAtom(isLoadingAtom)
  const isAuthenticated = useAtomValue(isAuthenticatedAtom)
  const queryClient = useQueryClient()
  const router = useRouter()

  const clearAuth = () => {
    setUser(null)
    setAccessToken('')
    setRefreshToken('')
    apiService.setAccessToken('')
    queryClient.clear()
  }

  const completeCognitoLogin = useCallback(async (tokens: CognitoTokens) => {
    setAccessToken(tokens.access_token)
    apiService.setAccessToken(tokens.access_token)
    if (tokens.refresh_token) {
      setRefreshToken(tokens.refresh_token)
    }
    const resp = await apiService.getMe()
    if (resp.success && resp.data) {
      setUser({
        id: resp.data.id,
        username: resp.data.name,
        email: resp.data.email,
        status: resp.data.status,
        isLoggedIn: true,
      })
    } else {
      setUser({
        id: 'cognito-user',
        username: 'user',
        email: '',
        status: 'active',
        isLoggedIn: true,
      })
    }
  }, [setAccessToken, setRefreshToken, setUser])

  const signIn = async () => {
    setIsLoading(true)
    try {
      await beginCognitoSignIn()
    } finally {
      setIsLoading(false)
    }
  }

  const logoutMutation = useMutation({
    mutationFn: async () => {
      setIsLoading(true)
      clearAuth()
    },
    onSuccess: () => {
      setIsLoading(false)
      cognitoLogout()
    },
    onError: () => {
      setIsLoading(false)
      router.push('/')
    },
  })

  const initializeSession = async () => {
    if (!accessToken) return
    apiService.setAccessToken(accessToken)
    try {
      const resp = await apiService.getMe()
      if (resp.success && resp.data) {
        setUser({
          id: resp.data.id,
          username: resp.data.name,
          email: resp.data.email,
          status: resp.data.status,
          isLoggedIn: true,
        })
      } else {
        clearAuth()
      }
    } catch {
      clearAuth()
    }
  }

  return {
    user,
    isLoading,
    isAuthenticated,
    signIn,
    logout: logoutMutation.mutateAsync,
    completeCognitoLogin,
    initializeSession,
  }
}
