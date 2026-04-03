import type { SubmitEventHandler } from 'react'
import styles from './AuthForm.module.scss'
import { OtpCodeInput } from './OtpCodeInput'

interface OtpVerificationFormProps {
  otp: string
  loading: boolean
  error?: string
  onOtpChange: (nextValue: string) => void
  onSubmit: SubmitEventHandler<HTMLFormElement>
  onUseDifferentEmail: () => void
}

export function OtpVerificationForm({
  otp,
  loading,
  error,
  onOtpChange,
  onSubmit,
  onUseDifferentEmail,
}: OtpVerificationFormProps) {
  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="login-otp">
          Enter 6-digit code
        </label>
        <OtpCodeInput id="login-otp" value={otp} disabled={loading} onChange={onOtpChange} />
      </div>

      <button className={styles.button} type="submit" disabled={loading || otp.length !== 6}>
        {loading ? 'Verifying...' : 'Verify code'}
      </button>

      <button
        className={styles.linkButton}
        type="button"
        onClick={onUseDifferentEmail}
        disabled={loading}
      >
        Use a different email
      </button>

      {error ? <p className={styles.error}>{error}</p> : null}
    </form>
  )
}
