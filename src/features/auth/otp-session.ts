const OTP_SESSION_KEY = 'pending_otp_session'

export interface PendingOtpSession {
  email: string
  sessionId: string
}

function parsePendingOtpSession(value: string): PendingOtpSession | null {
  try {
    const parsed = JSON.parse(value) as Partial<PendingOtpSession>

    if (typeof parsed.email !== 'string' || typeof parsed.sessionId !== 'string') {
      return null
    }

    return {
      email: parsed.email,
      sessionId: parsed.sessionId,
    }
  } catch {
    return null
  }
}

export function getPendingOtpSession(): PendingOtpSession | null {
  const raw = sessionStorage.getItem(OTP_SESSION_KEY)
  if (!raw) return null

  const pending = parsePendingOtpSession(raw)
  if (!pending) {
    sessionStorage.removeItem(OTP_SESSION_KEY)
    return null
  }

  return pending
}

export function setPendingOtpSession(pending: PendingOtpSession): void {
  sessionStorage.setItem(OTP_SESSION_KEY, JSON.stringify(pending))
}

export function clearPendingOtpSession(): void {
  sessionStorage.removeItem(OTP_SESSION_KEY)
}
