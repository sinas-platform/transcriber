import { useCallback, useEffect, useRef, useState, type SubmitEventHandler } from 'react'
import { useNavigate } from 'react-router-dom'
import { AuthCard } from '../features/auth/components/AuthCard'
import { OtpVerificationForm } from '../features/auth/components/OtpVerificationForm'
import {
  clearPendingOtpSession,
  getPendingOtpSession,
  type PendingOtpSession,
} from '../features/auth/otp-session'
import { useAuth } from '../features/auth/use-auth'
import { getAuthErrorMessage } from '../features/auth/utils/get-auth-error-message'
import { otpSchema } from '../lib/validation'

export function OtpPage() {
  const navigate = useNavigate()
  const { verifyLoginOtp } = useAuth()

  const [pendingSession, setPendingSession] = useState<PendingOtpSession | null>(() =>
    getPendingOtpSession(),
  )
  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const lastAutoSubmittedOtp = useRef<string | null>(null)

  useEffect(() => {
    if (pendingSession) return
    navigate('/auth/login', { replace: true })
  }, [navigate, pendingSession])

  const verifyOtpCode = useCallback(
    async (otpCode: string) => {
      if (!pendingSession || loading) return

      setError('')
      const cleanOtp = otpCode.replace(/\D/g, '').slice(0, 6)
      const parsedOtp = otpSchema.safeParse(cleanOtp)
      if (!parsedOtp.success) {
        setError(parsedOtp.error.issues[0]?.message ?? 'Enter a valid 6-digit code.')
        return
      }

      setLoading(true)

      try {
        await verifyLoginOtp(pendingSession.sessionId, parsedOtp.data)
        clearPendingOtpSession()
        navigate('/', { replace: true })
      } catch (err) {
        setError(getAuthErrorMessage(err, 'Invalid OTP code'))
      } finally {
        setLoading(false)
      }
    },
    [loading, navigate, pendingSession, verifyLoginOtp],
  )

  useEffect(() => {
    if (!pendingSession || loading) return

    const cleanOtp = otp.replace(/\D/g, '').slice(0, 6)
    if (cleanOtp.length !== 6) {
      lastAutoSubmittedOtp.current = null
      return
    }

    if (lastAutoSubmittedOtp.current === cleanOtp) return
    lastAutoSubmittedOtp.current = cleanOtp

    void verifyOtpCode(cleanOtp)
  }, [loading, otp, pendingSession, verifyOtpCode])

  const submitOtp: SubmitEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault()
    await verifyOtpCode(otp)
  }

  if (!pendingSession) return null

  return (
    <AuthCard title="Insert your one-time code" subtitle={`Code sent to ${pendingSession.email}`}>
      <OtpVerificationForm
        otp={otp}
        loading={loading}
        error={error}
        onOtpChange={(nextOtp) => {
          const cleanOtp = nextOtp.replace(/\D/g, '').slice(0, 6)
          setOtp(cleanOtp)
          if (error) setError('')
        }}
        onSubmit={submitOtp}
        onUseDifferentEmail={() => {
          clearPendingOtpSession()
          setPendingSession(null)
          navigate('/auth/login', { replace: true })
        }}
      />
    </AuthCard>
  )
}
