import { useMemo, useState, type ReactNode } from 'react'
import {
  clearAuthSession,
  persistAuthSession,
  requestOtp,
  restoreAuthSession,
  verifyOtp,
  type AuthSession,
} from '../../lib/auth'
import { AuthContext, type AuthContextValue } from './auth-context'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(() => restoreAuthSession())

  const requestLoginOtp = async (email: string): Promise<string> => {
    return requestOtp(email)
  }

  const verifyLoginOtp = async (sessionId: string, otpCode: string): Promise<void> => {
    const nextSession = await verifyOtp(sessionId, otpCode)
    persistAuthSession(nextSession)
    setSession(nextSession)
  }

  const logout = (): void => {
    clearAuthSession()
    setSession(null)
  }

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      isAuthenticated: !!session,
      requestLoginOtp,
      verifyLoginOtp,
      logout,
    }),
    [session],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
