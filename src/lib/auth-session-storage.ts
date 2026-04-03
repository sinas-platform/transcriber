const AUTH_SESSION_KEY = 'auth_session'
const ACCESS_TOKEN_KEY = 'auth_token'

export interface StoredAuthSessionRecord {
  accessToken: string
  refreshToken: string
  tokenType: string
  expiresIn: number
  user: unknown
}

function parseStoredSession(value: string): StoredAuthSessionRecord | null {
  try {
    const parsed = JSON.parse(value) as Partial<StoredAuthSessionRecord>

    if (
      typeof parsed.accessToken !== 'string' ||
      typeof parsed.refreshToken !== 'string' ||
      typeof parsed.tokenType !== 'string' ||
      typeof parsed.expiresIn !== 'number' ||
      parsed.user === null ||
      typeof parsed.user !== 'object'
    ) {
      return null
    }

    return {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      tokenType: parsed.tokenType,
      expiresIn: parsed.expiresIn,
      user: parsed.user,
    }
  } catch {
    return null
  }
}

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_TOKEN_KEY)
}

export function setAccessTokenStorage(token: string | null): void {
  if (token) {
    localStorage.setItem(ACCESS_TOKEN_KEY, token)
    return
  }

  localStorage.removeItem(ACCESS_TOKEN_KEY)
}

export function readStoredAuthSession(): StoredAuthSessionRecord | null {
  const raw = localStorage.getItem(AUTH_SESSION_KEY)
  if (!raw) return null

  const parsed = parseStoredSession(raw)
  if (!parsed) {
    localStorage.removeItem(AUTH_SESSION_KEY)
    setAccessTokenStorage(null)
    return null
  }

  return parsed
}

export function writeStoredAuthSession(session: StoredAuthSessionRecord): void {
  localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session))
  setAccessTokenStorage(session.accessToken)
}

export function clearStoredAuthSession(): void {
  localStorage.removeItem(AUTH_SESSION_KEY)
  setAccessTokenStorage(null)
}

export function replaceStoredAccessToken(
  accessToken: string,
  tokenType?: string,
  expiresIn?: number,
): StoredAuthSessionRecord | null {
  const current = readStoredAuthSession()
  if (!current) return null

  const updated: StoredAuthSessionRecord = {
    ...current,
    accessToken,
    tokenType: tokenType ?? current.tokenType,
    expiresIn: expiresIn ?? current.expiresIn,
  }

  writeStoredAuthSession(updated)
  return updated
}
