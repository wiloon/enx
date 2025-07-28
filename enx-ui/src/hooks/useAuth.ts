import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useAtom } from 'jotai'
import { userAtom, sessionIdAtom, isLoadingAtom } from '@/store/authAtoms'
import { apiService } from '@/services/api'
import { AuthResponse } from '@/types'

export const useAuth = () => {
  const [user, setUser] = useAtom(userAtom)
  const [sessionId, setSessionId] = useAtom(sessionIdAtom)
  const [isLoading, setIsLoading] = useAtom(isLoadingAtom)
  const queryClient = useQueryClient()
  const router = useRouter()

  const loginMutation = useMutation({
    mutationFn: async ({ username, password }: { username: string; password: string }) => {
      setIsLoading(true)
      const response = await apiService.login(username, password)
      if (!response.success) {
        throw new Error(response.error || 'Login failed')
      }
      return response.data!
    },
    onSuccess: (data: AuthResponse) => {
      setUser({ ...data.user, isLoggedIn: true })
      setSessionId(data.sessionId)
      apiService.setSessionId(data.sessionId)
      setIsLoading(false)
      router.push('/lookup')
    },
    onError: (error: Error) => {
      console.error('Login error:', error)
      setIsLoading(false)
    },
  })

  const logoutMutation = useMutation({
    mutationFn: async () => {
      setIsLoading(true)
      const response = await apiService.logout()
      if (!response.success) {
        throw new Error(response.error || 'Logout failed')
      }
    },
    onSuccess: () => {
      setUser(null)
      setSessionId('')
      apiService.setSessionId('')
      queryClient.clear()
      setIsLoading(false)
    },
    onError: (error: Error) => {
      console.error('Logout error:', error)
      setIsLoading(false)
    },
  })

  const registerMutation = useMutation({
    mutationFn: async ({ username, email, password }: { username: string; email: string; password: string }) => {
      setIsLoading(true)
      const response = await apiService.register(username, email, password)
      if (!response.success) {
        throw new Error(response.error || 'Registration failed')
      }
      return response.data!
    },
    onSuccess: (data: AuthResponse) => {
      setUser({ ...data.user, isLoggedIn: true })
      setSessionId(data.sessionId)
      apiService.setSessionId(data.sessionId)
      setIsLoading(false)
      router.push('/lookup')
    },
    onError: (error: Error) => {
      console.error('Registration error:', error)
      setIsLoading(false)
    },
  })

  // Initialize session on mount if we have stored session data
  const initializeSession = () => {
    if (sessionId) {
      apiService.setSessionId(sessionId)
    }
  }

  return {
    user,
    isLoading,
    isAuthenticated: !!(user && sessionId && user.isLoggedIn),
    login: loginMutation.mutateAsync,
    logout: logoutMutation.mutateAsync,
    register: registerMutation.mutateAsync,
    loginError: loginMutation.error?.message,
    logoutError: logoutMutation.error?.message,
    registerError: registerMutation.error?.message,
    initializeSession,
  }
}