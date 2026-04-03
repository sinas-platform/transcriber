import { ChevronLeft, LogOut, Plus, Settings } from 'lucide-react'
import { useMemo } from 'react'
import sinasLogo from '../../icons/sinas-logo.svg'
import type { RecordingFile } from '../../lib/recordings'
import styles from './Sidebar.module.scss'

interface SidebarProps {
  isLoadingRecordings: boolean
  recordingsError: string | null
  recordings: RecordingFile[]
  userEmail?: string | null
  onClose: () => void
  onNewRecording: () => void
  onLogout: () => void
}

function readMetadataDurationMs(metadata: Record<string, unknown>): number | null {
  const value = metadata.duration_ms
  if (typeof value !== 'number' || Number.isNaN(value)) return null
  return value
}

function readMetadataRecordedAt(metadata: Record<string, unknown>): string | null {
  const value = metadata.recorded_at
  return typeof value === 'string' ? value : null
}

function formatRecordingDuration(durationMs: number | null): string {
  if (!durationMs || durationMs <= 0) return '--:--'

  const totalSeconds = Math.floor(durationMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function formatRecordedTime(iso: string | null): string {
  if (!iso) return ''

  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''

  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function normalizeRecordingLabel(name: string): string {
  return name.replace(/\.[^.]+$/, '').replace(/^recording[-_]?/i, '').replace(/[-_]/g, ' ').trim() || name
}

export function Sidebar({
  isLoadingRecordings,
  recordingsError,
  recordings,
  userEmail,
  onClose,
  onNewRecording,
  onLogout,
}: SidebarProps) {
  const visibleRecordings = useMemo(() => {
    const sorted = [...recordings].sort((left, right) => {
      const leftRecordedAt = readMetadataRecordedAt(left.metadata)
      const rightRecordedAt = readMetadataRecordedAt(right.metadata)

      const leftMs = leftRecordedAt ? new Date(leftRecordedAt).getTime() : new Date(left.updatedAt).getTime()
      const rightMs = rightRecordedAt ? new Date(rightRecordedAt).getTime() : new Date(right.updatedAt).getTime()

      return rightMs - leftMs
    })

    return sorted.slice(0, 5)
  }, [recordings])

  return (
    <div className={`app-root ${styles.sidebarScreen}`}>
      <button
        type='button'
        className={styles.sidebarBackdrop}
        onClick={onClose}
        aria-label='Close sidebar overlay'
      />

      <aside className={styles.sidebarPanel}>
        <header className={styles.sidebarHeader}>
          <img className={styles.sidebarLogo} src={sinasLogo} alt='Sinas' />
          <button
            type='button'
            className={styles.sidebarCloseButton}
            onClick={onClose}
            aria-label='Close sidebar'
          >
            <ChevronLeft size={24} />
          </button>
        </header>

        <button type='button' className={styles.newRecordingButton} onClick={onNewRecording}>
          <Plus size={16} className={styles.newRecordingPlus} />
          <span>New recording</span>
        </button>

        <section className={styles.sidebarBody}>
          <p className={styles.sidebarSectionLabel}>Recordings</p>

          {isLoadingRecordings ? <p className={styles.sidebarStateText}>Loading recordings...</p> : null}
          {!isLoadingRecordings && recordingsError ? <p className={styles.sidebarStateText}>{recordingsError}</p> : null}
          {!isLoadingRecordings && !recordingsError && visibleRecordings.length === 0 ? (
            <p className={styles.sidebarStateText}>No recordings yet.</p>
          ) : null}

          {!isLoadingRecordings && !recordingsError && visibleRecordings.length > 0 ? (
            <ul className={styles.recordingsList}>
              {visibleRecordings.map((recording) => {
                const durationLabel = formatRecordingDuration(readMetadataDurationMs(recording.metadata))
                const recordedLabel = formatRecordedTime(readMetadataRecordedAt(recording.metadata))

                return (
                  <li key={recording.id} className={styles.recordingsItem}>
                    <div className={styles.recordingsItemContent}>
                      <p className={styles.recordingsItemTitle}>{normalizeRecordingLabel(recording.name)}</p>
                      <p className={styles.recordingsItemMeta}>
                        {durationLabel}
                        {recordedLabel ? ` • ${recordedLabel}` : ''}
                      </p>
                    </div>
                  </li>
                )
              })}
            </ul>
          ) : null}

          <button type='button' className={styles.allRecordingsButton}>
            ↗ All recordings
          </button>
        </section>

        <footer className={styles.sidebarFooter}>
          <button type='button' className={styles.sidebarFooterAction}>
            <Settings size={18} />
            <span>Settings</span>
          </button>
          <button type='button' className={styles.sidebarFooterAction} onClick={onLogout}>
            <LogOut size={18} />
            <span>{userEmail ?? 'Account'}</span>
          </button>
        </footer>
      </aside>
    </div>
  )
}
