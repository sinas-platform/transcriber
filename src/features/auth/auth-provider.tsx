import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
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
import { AUTH_SESSION_INVALIDATED_EVENT, setApiBaseUrl } from '../../lib/axios'
import { getWorkspaceUrl } from '../../lib/workspace'
import { AuthContext, type AuthContextValue } from './auth-context'

function normalizeWorkspaceUrl(value?: string | null): string {
  return (value ?? '').trim().replace(/\/+$/, '')
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const location = useLocation()
  const activeWorkspaceUrl = useMemo(
    () => normalizeWorkspaceUrl(getWorkspaceUrl()),
    [location.pathname, location.search],
  )
  const activeWorkspaceRef = useRef(activeWorkspaceUrl)
  const [session, setSession] = useState<AuthSession | null>(() => restoreAuthSession(activeWorkspaceUrl))
  const refreshTimerRef = useRef<number | null>(null)
  const refreshToken = session?.refreshToken ?? null

  useEffect(() => {
    activeWorkspaceRef.current = activeWorkspaceUrl
  }, [activeWorkspaceUrl])

  useEffect(() => {
    setApiBaseUrl(activeWorkspaceUrl || undefined)
    setSession(restoreAuthSession(activeWorkspaceUrl))
  }, [activeWorkspaceUrl])

  useEffect(() => {
    const handleSessionInvalidated = (event: Event): void => {
      const detail = (event as CustomEvent<{ workspaceUrl?: string }>).detail
      const invalidatedWorkspaceUrl = normalizeWorkspaceUrl(detail?.workspaceUrl)

      if (!invalidatedWorkspaceUrl) return
      if (invalidatedWorkspaceUrl !== activeWorkspaceRef.current) return

      setSession(null)
    }

    window.addEventListener(AUTH_SESSION_INVALIDATED_EVENT, handleSessionInvalidated as EventListener)
    return () => {
      window.removeEventListener(AUTH_SESSION_INVALIDATED_EVENT, handleSessionInvalidated as EventListener)
    }
  }, [])

  useEffect(() => {
    if (!refreshToken) return

    let cancelled = false
    const workspaceForValidation = activeWorkspaceUrl

    const validateSession = async (): Promise<void> => {
      try {
        const user = await getCurrentUser()
        if (cancelled) return
        if (workspaceForValidation !== activeWorkspaceRef.current) return

        setSession((currentSession) => {
          if (!currentSession) return null
          if (workspaceForValidation !== activeWorkspaceRef.current) return currentSession
          const nextSession = { ...currentSession, user }
          persistAuthSession(nextSession, workspaceForValidation)
          return nextSession
        })
      } catch {
        if (cancelled) return
        if (workspaceForValidation !== activeWorkspaceRef.current) return
        clearAuthSession(workspaceForValidation)
        setSession(null)
      }
    }

    void validateSession()

    return () => {
      cancelled = true
    }
  }, [activeWorkspaceUrl, refreshToken])

  useEffect(() => {
    if (refreshTimerRef.current) {
      window.clearInterval(refreshTimerRef.current)
      refreshTimerRef.current = null
    }

    if (!refreshToken) return
    const workspaceForRefresh = activeWorkspaceUrl

    refreshTimerRef.current = window.setInterval(async () => {
      if (workspaceForRefresh !== activeWorkspaceRef.current) return

      const currentSession = restoreAuthSession(workspaceForRefresh)
      if (!currentSession) {
        if (workspaceForRefresh !== activeWorkspaceRef.current) return
        setSession(null)
        return
      }

      try {
        const refreshed = await refreshAccessToken(currentSession.refreshToken, workspaceForRefresh)
        if (workspaceForRefresh !== activeWorkspaceRef.current) return

        const nextSession = applyRefreshedAccessToken(currentSession, refreshed, workspaceForRefresh)
        setSession(nextSession)
      } catch {
        if (workspaceForRefresh !== activeWorkspaceRef.current) return
        clearAuthSession(workspaceForRefresh)
        setSession(null)
      }
    }, 14 * 60 * 1000)

    return () => {
      if (!refreshTimerRef.current) return
      window.clearInterval(refreshTimerRef.current)
      refreshTimerRef.current = null
    }
  }, [activeWorkspaceUrl, refreshToken])

  const requestLoginOtp = useCallback(async (email: string): Promise<string> => {
    return requestOtp(email)
  }, [])

  const verifyLoginOtp = useCallback(async (sessionId: string, otpCode: string): Promise<void> => {
    const workspaceForLogin = activeWorkspaceRef.current
    const nextSession = await verifyOtp(sessionId, otpCode)
    persistAuthSession(nextSession, workspaceForLogin)
    if (workspaceForLogin !== activeWorkspaceRef.current) return
    setSession(nextSession)
  }, [])

  const logout = useCallback((): void => {
    const workspaceForLogout = activeWorkspaceRef.current

    if (refreshTimerRef.current) {
      window.clearInterval(refreshTimerRef.current)
      refreshTimerRef.current = null
    }

    if (refreshToken) {
      void revokeRefreshToken(refreshToken).catch(() => undefined)
    }

    clearAuthSession(workspaceForLogout)
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
