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
  onSelectRecording: (recording: RecordingFile) => void
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

function readMetadataDetailsDate(metadata: Record<string, unknown>): string | null {
  const value = metadata.details_date
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized || null
}

function readMetadataDetailsTime(metadata: Record<string, unknown>): string | null {
  const value = metadata.details_time
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized || null
}

function buildEffectiveRecordedAt(metadata: Record<string, unknown>, fallbackIso: string | null): string | null {
  const detailsDate = readMetadataDetailsDate(metadata)
  const detailsTime = readMetadataDetailsTime(metadata)

  const dateMatch = detailsDate ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(detailsDate) : null
  const timeMatch = detailsTime ? /^([01]\d|2[0-3]):([0-5]\d)$/.exec(detailsTime) : null

  if (dateMatch) {
    const year = Number.parseInt(dateMatch[1], 10)
    const monthIndex = Number.parseInt(dateMatch[2], 10) - 1
    const day = Number.parseInt(dateMatch[3], 10)
    const hours = timeMatch ? Number.parseInt(timeMatch[1], 10) : 0
    const minutes = timeMatch ? Number.parseInt(timeMatch[2], 10) : 0
    const parsed = new Date(year, monthIndex, day, hours, minutes, 0, 0)

    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString()
    }
  }

  if (timeMatch && fallbackIso) {
    const fallbackDate = new Date(fallbackIso)
    if (!Number.isNaN(fallbackDate.getTime())) {
      const hours = Number.parseInt(timeMatch[1], 10)
      const minutes = Number.parseInt(timeMatch[2], 10)
      const parsed = new Date(
        fallbackDate.getFullYear(),
        fallbackDate.getMonth(),
        fallbackDate.getDate(),
        hours,
        minutes,
        0,
        0,
      )

      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString()
      }
    }
  }

  return fallbackIso
}

function readMetadataTitle(metadata: Record<string, unknown>): string | null {
  const value = metadata.title
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized || null
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

  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
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
  onSelectRecording,
  onLogout,
}: SidebarProps) {
  const visibleRecordings = useMemo(() => {
    const sorted = [...recordings].sort((left, right) => {
      const leftFallbackRecordedAt = readMetadataRecordedAt(left.metadata) ?? left.updatedAt
      const rightFallbackRecordedAt = readMetadataRecordedAt(right.metadata) ?? right.updatedAt
      const leftRecordedAt = buildEffectiveRecordedAt(left.metadata, leftFallbackRecordedAt)
      const rightRecordedAt = buildEffectiveRecordedAt(right.metadata, rightFallbackRecordedAt)

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
                const fallbackRecordedAt = readMetadataRecordedAt(recording.metadata) ?? recording.updatedAt
                const effectiveRecordedAt = buildEffectiveRecordedAt(recording.metadata, fallbackRecordedAt)
                const recordedLabel = formatRecordedTime(effectiveRecordedAt)
                const titleLabel = readMetadataTitle(recording.metadata) || normalizeRecordingLabel(recording.name)

                return (
                  <li key={recording.id} className={styles.recordingsItem}>
                    <button
                      type='button'
                      className={styles.recordingsItemButton}
                      onClick={() => onSelectRecording(recording)}
                    >
                      <div className={styles.recordingsItemContent}>
                        <p className={styles.recordingsItemTitle}>{titleLabel}</p>
                        <p className={styles.recordingsItemMeta}>
                          {durationLabel}
                          {recordedLabel ? ` • ${recordedLabel}` : ''}
                        </p>
                      </div>
                    </button>
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
