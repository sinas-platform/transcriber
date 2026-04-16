import { getWorkspaceUrl } from './workspace'

const LEGACY_AUTH_SESSION_KEY = 'auth_session'
const LEGACY_ACCESS_TOKEN_KEY = 'auth_token'

const AUTH_TOKEN_PREFIX = 'authToken:'
const REFRESH_TOKEN_PREFIX = 'refreshToken:'
const TOKEN_TYPE_PREFIX = 'tokenType:'
const EXPIRES_IN_PREFIX = 'expiresIn:'
const USER_PREFIX = 'user:'

export interface StoredAuthSessionRecord {
  accessToken: string
  refreshToken: string
  tokenType: string
  expiresIn: number
  user: unknown
}

function parseStoredUser(value: string): unknown | null {
  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

function normalizeWorkspaceScope(workspaceUrl?: string | null): string {
  return (workspaceUrl ?? getWorkspaceUrl()).trim().replace(/\/+$/, '')
}

function scopedStorageKey(prefix: string, workspaceUrl: string): string {
  return `${prefix}${workspaceUrl}`
}

function clearScopedAuthSession(workspaceUrl: string): void {
  localStorage.removeItem(scopedStorageKey(AUTH_TOKEN_PREFIX, workspaceUrl))
  localStorage.removeItem(scopedStorageKey(REFRESH_TOKEN_PREFIX, workspaceUrl))
  localStorage.removeItem(scopedStorageKey(TOKEN_TYPE_PREFIX, workspaceUrl))
  localStorage.removeItem(scopedStorageKey(EXPIRES_IN_PREFIX, workspaceUrl))
  localStorage.removeItem(scopedStorageKey(USER_PREFIX, workspaceUrl))
}

function clearLegacyGlobalAuthStorage(): void {
  localStorage.removeItem(LEGACY_AUTH_SESSION_KEY)
  localStorage.removeItem(LEGACY_ACCESS_TOKEN_KEY)
}

function resolveWorkspaceScope(workspaceUrl?: string): string {
  clearLegacyGlobalAuthStorage()
  return normalizeWorkspaceScope(workspaceUrl)
}

export function getAccessToken(workspaceUrl?: string): string | null {
  const scope = resolveWorkspaceScope(workspaceUrl)
  if (!scope) return null
  return localStorage.getItem(scopedStorageKey(AUTH_TOKEN_PREFIX, scope))
}

export function setAccessTokenStorage(token: string | null, workspaceUrl?: string): void {
  const scope = resolveWorkspaceScope(workspaceUrl)
  if (!scope) return

  const key = scopedStorageKey(AUTH_TOKEN_PREFIX, scope)
  if (token) {
    localStorage.setItem(key, token)
    return
  }

  localStorage.removeItem(key)
}

export function readStoredAuthSession(workspaceUrl?: string): StoredAuthSessionRecord | null {
  const scope = resolveWorkspaceScope(workspaceUrl)
  if (!scope) return null

  const accessToken = localStorage.getItem(scopedStorageKey(AUTH_TOKEN_PREFIX, scope))
  const refreshToken = localStorage.getItem(scopedStorageKey(REFRESH_TOKEN_PREFIX, scope))
  const tokenType = localStorage.getItem(scopedStorageKey(TOKEN_TYPE_PREFIX, scope))
  const rawExpiresIn = localStorage.getItem(scopedStorageKey(EXPIRES_IN_PREFIX, scope))
  const rawUser = localStorage.getItem(scopedStorageKey(USER_PREFIX, scope))

  if (!accessToken && !refreshToken && !tokenType && !rawExpiresIn && !rawUser) {
    return null
  }

  const expiresIn = Number(rawExpiresIn)
  const user = rawUser ? parseStoredUser(rawUser) : null

  if (
    !accessToken ||
    !refreshToken ||
    !tokenType ||
    !Number.isFinite(expiresIn) ||
    !user ||
    typeof user !== 'object'
  ) {
    clearScopedAuthSession(scope)
    return null
  }

  return {
    accessToken,
    refreshToken,
    tokenType,
    expiresIn,
    user,
  }
}

export function writeStoredAuthSession(session: StoredAuthSessionRecord, workspaceUrl?: string): void {
  const scope = resolveWorkspaceScope(workspaceUrl)
  if (!scope) return

  localStorage.setItem(scopedStorageKey(AUTH_TOKEN_PREFIX, scope), session.accessToken)
  localStorage.setItem(scopedStorageKey(REFRESH_TOKEN_PREFIX, scope), session.refreshToken)
  localStorage.setItem(scopedStorageKey(TOKEN_TYPE_PREFIX, scope), session.tokenType)
  localStorage.setItem(scopedStorageKey(EXPIRES_IN_PREFIX, scope), String(session.expiresIn))
  localStorage.setItem(scopedStorageKey(USER_PREFIX, scope), JSON.stringify(session.user))
}

export function clearStoredAuthSession(workspaceUrl?: string): void {
  const scope = resolveWorkspaceScope(workspaceUrl)
  if (!scope) return
  clearScopedAuthSession(scope)
}

export function replaceStoredAccessToken(
  accessToken: string,
  tokenType?: string,
  expiresIn?: number,
  workspaceUrl?: string,
): StoredAuthSessionRecord | null {
  const current = readStoredAuthSession(workspaceUrl)
  if (!current) return null

  const updated: StoredAuthSessionRecord = {
    ...current,
    accessToken,
    tokenType: tokenType ?? current.tokenType,
    expiresIn: expiresIn ?? current.expiresIn,
  }

  writeStoredAuthSession(updated, workspaceUrl)
  return updated
}
