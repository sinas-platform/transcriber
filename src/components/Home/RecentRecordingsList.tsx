import { ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { RecordingFile } from '../../lib/recordings'
import styles from './RecentRecordingsList.module.scss'

interface RecentRecordingsListProps {
  isLoadingRecordings: boolean
  recordingsError: string | null
  recordings: RecordingFile[]
  onSelectRecording: (recording: RecordingFile) => void
}

type TranscriptionTone = 'success' | 'warning' | 'muted' | 'danger'

const COLLAPSED_RECORDINGS_COUNT = 5

const COMPLETED_TRANSCRIPTION_STATUSES = new Set(['completed', 'succeeded', 'done'])
const PENDING_TRANSCRIPTION_STATUSES = new Set(['pending', 'queued', 'processing', 'running'])
const FAILED_TRANSCRIPTION_STATUSES = new Set(['failed', 'error', 'cancelled'])
const STATUS_CLASS_BY_TONE: Record<TranscriptionTone, string> = {
  success: styles.statusSuccess,
  warning: styles.statusWarning,
  muted: styles.statusMuted,
  danger: styles.statusDanger,
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

function readMetadataTranscriptionStatus(metadata: Record<string, unknown>): string | null {
  const value = metadata.transcription_status
  if (typeof value !== 'string' || !value.trim()) return null
  return value.trim().toLowerCase()
}

function readMetadataTranscriptionText(metadata: Record<string, unknown>): string | null {
  const value = metadata.transcription_text
  if (typeof value !== 'string' || !value.trim()) return null
  return value
}

function normalizeRecordingLabel(name: string): string {
  return name.replace(/\.[^.]+$/, '').replace(/^recording[-_]?/i, '').replace(/[-_]/g, ' ').trim() || name
}

function formatRecordingDuration(durationMs: number | null): string {
  if (!durationMs || durationMs <= 0) return '--:--'

  const totalSeconds = Math.floor(durationMs / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function formatRelativeDateLabel(iso: string | null): string {
  if (!iso) return ''

  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''

  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const dayDifference = Math.round((startOfToday.getTime() - startOfDate.getTime()) / (1000 * 60 * 60 * 24))

  if (dayDifference === 0) return 'Today'
  if (dayDifference === 1) return 'Yesterday'
  if (dayDifference > 1 && dayDifference < 7) {
    return date.toLocaleDateString([], { weekday: 'long' })
  }

  return date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
  })
}

function readTranscriptionStatus(metadata: Record<string, unknown>): { label: string; tone: TranscriptionTone } {
  const status = readMetadataTranscriptionStatus(metadata)

  if (status && COMPLETED_TRANSCRIPTION_STATUSES.has(status)) {
    return { label: 'Transcribed', tone: 'success' }
  }

  if (status && PENDING_TRANSCRIPTION_STATUSES.has(status)) {
    return { label: 'Processing', tone: 'warning' }
  }

  if (status && FAILED_TRANSCRIPTION_STATUSES.has(status)) {
    return { label: 'Failed', tone: 'danger' }
  }

  if (readMetadataTranscriptionText(metadata)) {
    return { label: 'Transcribed', tone: 'success' }
  }

  return { label: 'No transcript', tone: 'muted' }
}

export function RecentRecordingsList({
  isLoadingRecordings,
  recordingsError,
  recordings,
  onSelectRecording,
}: RecentRecordingsListProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  const sortedRecordings = useMemo(() => {
    return [...recordings].sort((left, right) => {
      const leftFallbackRecordedAt = readMetadataRecordedAt(left.metadata) ?? left.updatedAt
      const rightFallbackRecordedAt = readMetadataRecordedAt(right.metadata) ?? right.updatedAt
      const leftRecordedAt = buildEffectiveRecordedAt(left.metadata, leftFallbackRecordedAt)
      const rightRecordedAt = buildEffectiveRecordedAt(right.metadata, rightFallbackRecordedAt)

      const leftMs = leftRecordedAt ? new Date(leftRecordedAt).getTime() : new Date(left.updatedAt).getTime()
      const rightMs = rightRecordedAt ? new Date(rightRecordedAt).getTime() : new Date(right.updatedAt).getTime()

      return rightMs - leftMs
    })
  }, [recordings])

  const visibleRecordings = useMemo(() => {
    if (isExpanded) return sortedRecordings
    return sortedRecordings.slice(0, COLLAPSED_RECORDINGS_COUNT)
  }, [isExpanded, sortedRecordings])

  const shouldShowToggle = sortedRecordings.length > COLLAPSED_RECORDINGS_COUNT

  return (
    <section className={styles.section}>
      <header className={styles.header}>
        <h2 className={styles.title}>Recent recordings</h2>

        {shouldShowToggle ? (
          <button type='button' className={styles.toggleButton} onClick={() => setIsExpanded((prev) => !prev)}>
            <span>{isExpanded ? 'Show less' : 'See all'}</span>
            <ChevronRight size={16} className={`${styles.toggleIcon} ${isExpanded ? styles.toggleIconExpanded : ''}`} />
          </button>
        ) : null}
      </header>

      {isLoadingRecordings ? <p className={styles.stateText}>Loading recordings...</p> : null}
      {!isLoadingRecordings && recordingsError ? <p className={styles.stateText}>{recordingsError}</p> : null}
      {!isLoadingRecordings && !recordingsError && visibleRecordings.length === 0 ? (
        <p className={styles.stateText}>No recordings yet.</p>
      ) : null}

      {!isLoadingRecordings && !recordingsError && visibleRecordings.length > 0 ? (
        <ul className={styles.list}>
          {visibleRecordings.map((recording) => {
            const durationLabel = formatRecordingDuration(readMetadataDurationMs(recording.metadata))
            const fallbackRecordedAt = readMetadataRecordedAt(recording.metadata) ?? recording.updatedAt
            const effectiveRecordedAt = buildEffectiveRecordedAt(recording.metadata, fallbackRecordedAt)
            const recordedLabel = formatRelativeDateLabel(effectiveRecordedAt)
            const titleLabel = readMetadataTitle(recording.metadata) || normalizeRecordingLabel(recording.name)
            const transcriptionStatus = readTranscriptionStatus(recording.metadata)
            const transcriptionStatusClass = STATUS_CLASS_BY_TONE[transcriptionStatus.tone]

            return (
              <li key={recording.id} className={styles.item}>
                <button type='button' className={styles.itemButton} onClick={() => onSelectRecording(recording)}>
                  <div className={styles.itemContent}>
                    <p className={styles.itemTitle}>{titleLabel}</p>
                    <p className={styles.itemMeta}>
                      {durationLabel}
                      {recordedLabel ? ` • ${recordedLabel}` : ''}
                    </p>
                  </div>

                  <div className={styles.itemStatus}>
                    <span className={`${styles.statusLabel} ${transcriptionStatusClass}`}>
                      <span className={styles.statusDot} />
                      {transcriptionStatus.label}
                    </span>
                    <span className={styles.itemIndicator} aria-hidden='true' />
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </section>
  )
}
