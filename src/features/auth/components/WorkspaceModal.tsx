import { useEffect, useMemo, useState } from 'react'
import { Input } from '../../../components/Input/Input'
import { workspaceUrlSchema } from '../../../lib/validation'
import styles from './WorkspaceModal.module.scss'

interface WorkspaceModalProps {
  initialValue: string
  onClose: () => void
  onSave: (url: string) => void
}

function stripWorkspaceProtocol(input: string): string {
  return input.trim().replace(/^https?:\/\//i, '').replace(/^\/+/, '')
}

export function WorkspaceModal({ initialValue, onClose, onSave }: WorkspaceModalProps) {
  const [value, setValue] = useState(() => stripWorkspaceProtocol(initialValue))
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('keydown', handleEscape)
    }
  }, [onClose])

  const fullWorkspaceUrl = useMemo(() => (value.trim() ? `https://${value.trim()}` : ''), [value])
  const parsedUrl = useMemo(() => workspaceUrlSchema.safeParse(fullWorkspaceUrl), [fullWorkspaceUrl])
  const valid = parsedUrl.success
  const rawErrorMessage = valid
    ? ''
    : (parsedUrl.error.issues[0]?.message ?? 'Please enter a valid https URL.')
  const errorMessage =
    rawErrorMessage === 'Please enter a valid http(s) URL.'
      ? 'Please enter a valid https URL.'
      : rawErrorMessage

  const handleSave = (): void => {
    setTouched(true)
    if (!parsedUrl.success) return
    onSave(parsedUrl.data)
  }

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Switch workspace">
      <button type="button" className={styles.backdrop} aria-label="Close workspace modal" onClick={onClose} />
      <div className={styles.panel}>
        <div className={styles.header}>
          <div>
            <h2 className={styles.title}>Switch workspace</h2>
            <p className={styles.subtitle}>Enter your Sinas server URL</p>
          </div>
          <button type="button" className={styles.closeButton} aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>

        <label className={styles.field}>
          <span className={styles.label}>Workspace URL</span>
          <div className={styles.inputRow}>
            <span className={styles.protocol}>https://</span>
            <Input
              value={value}
              autoFocus
              placeholder="workspace.example.com"
              className={styles.workspaceInput}
              onChange={(event) => {
                setValue(stripWorkspaceProtocol(event.target.value))
                setTouched(true)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  handleSave()
                }
              }}
            />
            <button
              type="button"
              className={styles.saveButton}
              onClick={handleSave}
              disabled={!valid}
            >
              Save
            </button>
          </div>
        </label>

        {touched && !valid ? <p className={styles.error}>{errorMessage}</p> : null}
      </div>
    </div>
  )
}
