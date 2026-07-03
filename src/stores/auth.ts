import { create } from 'zustand'
import type { CurrentUser } from '@/api/types'
import { authApi } from '@/api/auth'

interface AuthState {
  user: CurrentUser | null
  loading: boolean
  fetchUser: () => Promise<void>
  loginWithToken: (gitlabToken: string) => Promise<void>
  logout: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: true,
  fetchUser: async () => {
    set({ loading: true })
    if (!localStorage.getItem('token')) {
      set({ user: null, loading: false })
      return
    }
    try {
      const user = await authApi.me()
      set({ user, loading: false })
    } catch {
      set({ user: null, loading: false })
    }
  },
  loginWithToken: async (gitlabToken: string) => {
    const { token, user } = await authApi.login(gitlabToken)
    localStorage.setItem('token', token)
    set({ user, loading: false })
  },
  logout: async () => {
    await authApi.logout().catch(() => {})
    localStorage.removeItem('token')
    set({ user: null })
    window.location.href = '/login'
  },
}))
