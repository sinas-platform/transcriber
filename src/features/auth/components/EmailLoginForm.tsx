import type { SubmitEventHandler } from 'react'
import { Input } from '../../../components/Input/Input'
import styles from './AuthForm.module.scss'

interface EmailLoginFormProps {
  email: string
  loading: boolean
  emailError?: string
  error?: string
  workspaceLabel: string
  onSwitchWorkspace: () => void
  onEmailChange: (nextValue: string) => void
  onSubmit: SubmitEventHandler<HTMLFormElement>
}

export function EmailLoginForm({
  email,
  loading,
  emailError,
  error,
  workspaceLabel,
  onSwitchWorkspace,
  onEmailChange,
  onSubmit,
}: EmailLoginFormProps) {
  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="login-email">
          Email
        </label>
        <Input
          id="login-email"
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
          value={email}
          disabled={loading}
          onChange={(event) => onEmailChange(event.target.value)}
        />
      </div>

      {emailError ? <p className={styles.error}>{emailError}</p> : null}

      <button className={styles.button} type="submit" disabled={loading || !email.trim()}>
        {loading ? 'Sending code...' : 'Continue'}
      </button>

      <p className={styles.hint}>A one-time code will be sent to your email address.</p>
      <div className={styles.workspaceRow}>
        <p className={styles.workspaceLabel}>
          Connected to: <span className={styles.workspaceHost}>{workspaceLabel}</span>
        </p>
        <button
          className={styles.workspaceSwitchButton}
          type="button"
          onClick={onSwitchWorkspace}
          disabled={loading}
        >
          Switch workspace
        </button>
      </div>
      {error ? <p className={styles.error}>{error}</p> : null}
    </form>
  )
}
