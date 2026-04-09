import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  applyRefreshedAccessToken,
  clearAuthSession,
  getCurrentUser,
  persistAuthSession,
  refreshAccessToken,
  revokeRefreshToken,
  requestOtp,
  restoreAuthSession,
  verifyOtp,
  type AuthSession,
} from '../../lib/auth'
import { setApiBaseUrl } from '../../lib/axios'
import { getWorkspaceUrl } from '../../lib/workspace'
import { AuthContext, type AuthContextValue } from './auth-context'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(() => restoreAuthSession())
  const refreshTimerRef = useRef<number | null>(null)
  const refreshToken = session?.refreshToken ?? null

  useEffect(() => {
    setApiBaseUrl(getWorkspaceUrl() || undefined)
  }, [])

  useEffect(() => {
    if (!refreshToken) return

    let cancelled = false

    const validateSession = async (): Promise<void> => {
      try {
        const user = await getCurrentUser()
        if (cancelled) return

        setSession((currentSession) => {
          if (!currentSession) return null
          const nextSession = { ...currentSession, user }
          persistAuthSession(nextSession)
          return nextSession
        })
      } catch {
        if (cancelled) return
        clearAuthSession()
        setSession(null)
      }
    }

    void validateSession()

    return () => {
      cancelled = true
    }
  }, [refreshToken])

  useEffect(() => {
    if (refreshTimerRef.current) {
      window.clearInterval(refreshTimerRef.current)
      refreshTimerRef.current = null
    }

    if (!refreshToken) return

    refreshTimerRef.current = window.setInterval(async () => {
      const currentSession = restoreAuthSession()
      if (!currentSession) {
        setSession(null)
        return
      }

      try {
        const refreshed = await refreshAccessToken(currentSession.refreshToken)
        const nextSession = applyRefreshedAccessToken(currentSession, refreshed)
        setSession(nextSession)
      } catch {
        clearAuthSession()
        setSession(null)
      }
    }, 14 * 60 * 1000)

    return () => {
      if (!refreshTimerRef.current) return
      window.clearInterval(refreshTimerRef.current)
      refreshTimerRef.current = null
    }
  }, [refreshToken])

  const requestLoginOtp = useCallback(async (email: string): Promise<string> => {
    return requestOtp(email)
  }, [])

  const verifyLoginOtp = useCallback(async (sessionId: string, otpCode: string): Promise<void> => {
    const nextSession = await verifyOtp(sessionId, otpCode)
    persistAuthSession(nextSession)
    setSession(nextSession)
  }, [])

  const logout = useCallback((): void => {
    if (refreshTimerRef.current) {
      window.clearInterval(refreshTimerRef.current)
      refreshTimerRef.current = null
    }

    if (refreshToken) {
      void revokeRefreshToken(refreshToken).catch(() => undefined)
    }

    clearAuthSession()
    setSession(null)
  }, [refreshToken])

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      isAuthenticated: !!session,
      requestLoginOtp,
      verifyLoginOtp,
      logout,
    }),
    [logout, requestLoginOtp, session, verifyLoginOtp],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
