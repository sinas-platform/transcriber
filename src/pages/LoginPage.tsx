import { useEffect, useMemo, useState, type SubmitEventHandler } from 'react'
import { useNavigate } from 'react-router-dom'
import { EmailLoginForm } from '../features/auth/components/EmailLoginForm'
import { AuthCard } from '../features/auth/components/AuthCard'
import { WorkspaceModal } from '../features/auth/components/WorkspaceModal'
import { clearPendingOtpSession, setPendingOtpSession } from '../features/auth/otp-session'
import { useAuth } from '../features/auth/use-auth'
import { getAuthErrorMessage } from '../features/auth/utils/get-auth-error-message'
import { setApiBaseUrl } from '../lib/axios'
import { emailSchema } from '../lib/validation'
import { getWorkspaceUrl, setWorkspaceUrl } from '../lib/workspace'

function prettyHost(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url.replace(/^https?:\/\//, '')
  }
}

export function LoginPage() {
  const navigate = useNavigate()
  const { requestLoginOtp } = useAuth()

  const [email, setEmail] = useState('')
  const [workspaceUrl, setWorkspaceUrlState] = useState(() => getWorkspaceUrl())
  const [loading, setLoading] = useState(false)
  const [emailError, setEmailError] = useState('')
  const [error, setError] = useState('')
  const [isWorkspaceModalOpen, setIsWorkspaceModalOpen] = useState(false)

  const workspaceLabel = useMemo(() => prettyHost(workspaceUrl), [workspaceUrl])

  useEffect(() => {
    setApiBaseUrl(workspaceUrl || undefined)
  }, [workspaceUrl])

  const submitEmail: SubmitEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault()
    if (loading) return

    setError('')
    const parsedEmail = emailSchema.safeParse(email)
    if (!parsedEmail.success) {
      setEmailError(parsedEmail.error.issues[0]?.message ?? 'Please enter a valid email.')
      return
    }

    setEmailError('')
    setLoading(true)

    try {
      const sessionId = await requestLoginOtp(parsedEmail.data)
      setPendingOtpSession({ email: parsedEmail.data, sessionId })
      navigate('/auth/otp', { replace: true })
    } catch (err) {
      setError(getAuthErrorMessage(err, 'Failed to send OTP'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <AuthCard>
        <EmailLoginForm
          email={email}
          loading={loading}
          emailError={emailError}
          error={error}
          workspaceLabel={workspaceLabel}
          onSwitchWorkspace={() => {
            setWorkspaceUrlState(getWorkspaceUrl())
            setIsWorkspaceModalOpen(true)
          }}
          onEmailChange={(nextEmail) => {
            setEmail(nextEmail)
            if (emailError) setEmailError('')
            if (error) setError('')
          }}
          onSubmit={submitEmail}
        />
      </AuthCard>

      {isWorkspaceModalOpen ? (
        <WorkspaceModal
          initialValue={workspaceUrl}
          onClose={() => setIsWorkspaceModalOpen(false)}
          onSave={(url) => {
            clearPendingOtpSession()
            setWorkspaceUrl(url)
            setWorkspaceUrlState(url)
            setApiBaseUrl(url)
            setError('')
            setEmailError('')
            setEmail('')
            setIsWorkspaceModalOpen(false)
          }}
        />
      ) : null}
    </>
  )
}
