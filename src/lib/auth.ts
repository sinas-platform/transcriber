import {
  clearStoredAuthSession,
  readStoredAuthSession,
  replaceStoredAccessToken,
  writeStoredAuthSession,
} from './auth-session-storage'
import { runtimeApi } from './axios'
import { endpoints } from './endpoints'

export interface AuthUser {
  id: string
  email: string
  role?: string | null
  roles?: string[]
  is_active?: boolean
  created_at: string
  last_login_at?: string | null
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

interface RefreshResponse {
  access_token: string
  token_type: string
  expires_in: number
}

interface RoleResponse {
  name: string
}

interface StoredSession {
  accessToken: string
  refreshToken: string
  tokenType: string
  expiresIn: number
  user: AuthUser
}

export type AuthSession = StoredSession

export function restoreAuthSession(): AuthSession | null {
  const session = readStoredAuthSession()
  if (!session) return null

  return {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    tokenType: session.tokenType,
    expiresIn: session.expiresIn,
    user: session.user as AuthUser,
  }
}

export function persistAuthSession(session: AuthSession): void {
  writeStoredAuthSession(session)
}

export function clearAuthSession(): void {
  clearStoredAuthSession()
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

export async function getCurrentUser(): Promise<AuthUser> {
  const response = await runtimeApi.get<AuthUser>(endpoints.auth.me)
  return response.data
}

export async function listCurrentUserRoles(): Promise<string[]> {
  const response = await runtimeApi.get<RoleResponse[]>(endpoints.config.roles)
  return response.data
    .map((role) => role.name)
    .filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
}

export async function refreshAccessToken(refreshToken: string): Promise<{
  accessToken: string
  tokenType: string
  expiresIn: number
}> {
  const response = await runtimeApi.post<RefreshResponse>(endpoints.auth.refresh, {
    refresh_token: refreshToken,
  })

  return {
    accessToken: response.data.access_token,
    tokenType: response.data.token_type,
    expiresIn: response.data.expires_in,
  }
}

export function applyRefreshedAccessToken(
  session: AuthSession,
  refreshed: { accessToken: string; tokenType: string; expiresIn: number },
): AuthSession {
  const nextSession: AuthSession = {
    ...session,
    accessToken: refreshed.accessToken,
    tokenType: refreshed.tokenType,
    expiresIn: refreshed.expiresIn,
  }

  persistAuthSession(nextSession)
  return nextSession
}

export async function revokeRefreshToken(refreshToken: string): Promise<void> {
  await runtimeApi.post(endpoints.auth.logout, {
    refresh_token: refreshToken,
  })
}

export function syncStoredSessionAccessToken(
  accessToken: string,
  tokenType?: string,
  expiresIn?: number,
): AuthSession | null {
  const updated = replaceStoredAccessToken(accessToken, tokenType, expiresIn)
  if (!updated) return null

  return {
    accessToken: updated.accessToken,
    refreshToken: updated.refreshToken,
    tokenType: updated.tokenType,
    expiresIn: updated.expiresIn,
    user: updated.user as AuthUser,
  }
}
