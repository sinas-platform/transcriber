import { createContext } from 'react'
import type { AuthSession } from '../../lib/auth'

export type AuthContextValue = {
  session: AuthSession | null
  isAuthenticated: boolean
  requestLoginOtp: (email: string) => Promise<string>
  verifyLoginOtp: (sessionId: string, otpCode: string) => Promise<void>
  logout: () => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)
