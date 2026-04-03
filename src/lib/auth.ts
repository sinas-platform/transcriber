import { runtimeApi, setAccessToken } from './axios'
import { endpoints } from './endpoints'

const AUTH_SESSION_KEY = 'auth_session'

export interface AuthUser {
  id: string
  email: string
  is_active: boolean
  created_at: string
  external_auth_provider?: string | null
  external_auth_id?: string | null
}

interface LoginResponse {
  message: string
  session_id: string
}

interface VerifyOtpResponse {
  access_token: string
  refresh_token: string
  token_type: string
  expires_in: number
  user: AuthUser
}

interface StoredSession {
  accessToken: string
  refreshToken: string
  tokenType: string
  expiresIn: number
  user: AuthUser
}

export type AuthSession = StoredSession

function parseStoredSession(value: string): AuthSession | null {
  try {
    const parsed = JSON.parse(value) as Partial<StoredSession>

    if (
      typeof parsed.accessToken !== 'string' ||
      typeof parsed.refreshToken !== 'string' ||
      typeof parsed.tokenType !== 'string' ||
      typeof parsed.expiresIn !== 'number' ||
      typeof parsed.user !== 'object' ||
      parsed.user === null
    ) {
      return null
    }

    return {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      tokenType: parsed.tokenType,
      expiresIn: parsed.expiresIn,
      user: parsed.user as AuthUser,
    }
  } catch {
    return null
  }
}

export function restoreAuthSession(): AuthSession | null {
  const raw = localStorage.getItem(AUTH_SESSION_KEY)
  if (!raw) return null

  const session = parseStoredSession(raw)
  if (!session) {
    localStorage.removeItem(AUTH_SESSION_KEY)
    setAccessToken(null)
    return null
  }

  setAccessToken(session.accessToken)
  return session
}

export function persistAuthSession(session: AuthSession): void {
  localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session))
  setAccessToken(session.accessToken)
}

export function clearAuthSession(): void {
  localStorage.removeItem(AUTH_SESSION_KEY)
  setAccessToken(null)
}

export async function requestOtp(email: string): Promise<string> {
  const response = await runtimeApi.post<LoginResponse>(endpoints.auth.login, { email })
  return response.data.session_id
}

export async function verifyOtp(sessionId: string, otpCode: string): Promise<AuthSession> {
  const response = await runtimeApi.post<VerifyOtpResponse>(endpoints.auth.verifyOtp, {
    session_id: sessionId,
    otp_code: otpCode,
  })

  const data = response.data
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    tokenType: data.token_type,
    expiresIn: data.expires_in,
    user: data.user,
  }
}
