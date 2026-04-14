import { ArrowLeft, Search, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Select, type SelectOption } from '../components/Select/Select'
import { buildRecordingSourceState } from '../lib/recording-navigation'
import {
  deleteRecording,
  getRecordingsTarget,
  listRecordings,
  type RecordingFile,
} from '../lib/recordings'
import styles from './AllRecordingsPage.module.scss'

type SortOptionValue = 'most_recent' | 'oldest' | 'title_asc' | 'title_desc'
type StatusFilterValue = 'all' | 'transcribed' | 'processing' | 'failed' | 'no_transcript'
type StatusTone = 'success' | 'warning' | 'danger' | 'muted'
type MetadataSearchEntry = {
  path: string
  text: string
  normalizedText: string
}
type SearchMatchReason = {
  label: string
  snippet: string
}

const STATUS_FILTER_OPTIONS: SelectOption[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'transcribed', label: 'Transcribed' },
  { value: 'processing', label: 'Processing' },
  { value: 'failed', label: 'Failed' },
  { value: 'no_transcript', label: 'No transcript' },
]

const SORT_OPTIONS: Array<{ value: SortOptionValue; label: string }> = [
  { value: 'most_recent', label: 'Most recent' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'title_asc', label: 'Title A-Z' },
  { value: 'title_desc', label: 'Title Z-A' },
]

const COMPLETED_TRANSCRIPTION_STATUSES = new Set(['completed', 'succeeded', 'done'])
const PENDING_TRANSCRIPTION_STATUSES = new Set(['pending', 'queued', 'processing', 'running'])
const FAILED_TRANSCRIPTION_STATUSES = new Set(['failed', 'error', 'cancelled'])

const STATUS_CLASS_BY_TONE: Record<StatusTone, string> = {
  success: styles.statusSuccess,
  warning: styles.statusWarning,
  danger: styles.statusDanger,
  muted: styles.statusMuted,
}

function joinClasses(...classes: Array<string | undefined | false>): string {
  return classes.filter(Boolean).join(' ')
}

function getApiErrorMessage(error: unknown, fallback: string): string {
  const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail

  if (typeof detail === 'string' && detail.trim()) {
    return detail
  }

  return fallback
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

function getRecordingTitle(recording: RecordingFile): string {
  return readMetadataTitle(recording.metadata) || normalizeRecordingLabel(recording.name)
}

function getRecordingSortTimestamp(recording: RecordingFile): number {
  const fallbackRecordedAt = readMetadataRecordedAt(recording.metadata) ?? recording.updatedAt
  const effectiveRecordedAt = buildEffectiveRecordedAt(recording.metadata, fallbackRecordedAt)
  const parsed = effectiveRecordedAt ? new Date(effectiveRecordedAt).getTime() : Number.NaN

  if (!Number.isNaN(parsed)) {
    return parsed
  }

  return new Date(recording.updatedAt).getTime()
}

function normalizeRecordingLabel(name: string): string {
  return name.replace(/\.[^.]+$/, '').replace(/^recording[-_]?/i, '').replace(/[-_]/g, ' ').trim() || name
}

function normalizeSearchableText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase()
}

function buildMetadataSearchEntries(metadata: Record<string, unknown>): MetadataSearchEntry[] {
  const entries: MetadataSearchEntry[] = []

  const visit = (value: unknown, depth: number, path: string[]): void => {
    if (depth > 6 || value === null || value === undefined) return

    if (typeof value === 'string') {
      const text = value.trim()
      if (!text) return
      entries.push({
        path: path.join('.'),
        text,
        normalizedText: normalizeSearchableText(text),
      })
      return
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      const text = String(value)
      entries.push({
        path: path.join('.'),
        text,
        normalizedText: normalizeSearchableText(text),
      })
      return
    }

    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, depth + 1, [...path, String(index)]))
      return
    }

    if (typeof value === 'object') {
      Object.entries(value as Record<string, unknown>).forEach(([key, entry]) =>
        visit(entry, depth + 1, [...path, key]),
      )
    }
  }

  visit(metadata, 0, [])
  return entries
}

function getSearchMatchLabel(path: string): string {
  if (path.startsWith('transcription_text')) return 'transcription'
  if (path.startsWith('transcription_error')) return 'transcription error'
  if (path.startsWith('details_members')) return 'members'
  if (path.startsWith('details_location')) return 'location'
  if (path.startsWith('details_date')) return 'date'
  if (path.startsWith('details_time')) return 'time'
  if (path.startsWith('recorded_at')) return 'recorded at'
  return 'metadata'
}

function buildMatchSnippet(text: string, normalizedQuery: string): string {
  const source = text.trim()
  if (!source) return ''
  if (!normalizedQuery) return source

  const loweredSource = source.toLowerCase()
  const matchIndex = loweredSource.indexOf(normalizedQuery)
  if (matchIndex < 0) {
    return source.length > 72 ? `${source.slice(0, 71)}…` : source
  }

  const start = Math.max(0, matchIndex - 22)
  const end = Math.min(source.length, matchIndex + normalizedQuery.length + 30)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < source.length ? '…' : ''
  return `${prefix}${source.slice(start, end)}${suffix}`
}

function findSearchMatchReason(
  recording: RecordingFile,
  normalizedQuery: string,
  metadataEntries: MetadataSearchEntry[],
): SearchMatchReason | null {
  if (!normalizedQuery) return null

  const normalizedTitle = normalizeSearchableText(getRecordingTitle(recording))
  const normalizedName = normalizeSearchableText(recording.name)
  if (normalizedTitle.includes(normalizedQuery) || normalizedName.includes(normalizedQuery)) {
    return null
  }

  const matchedEntry = metadataEntries.find((entry) => entry.normalizedText.includes(normalizedQuery))
  if (!matchedEntry) return null

  return {
    label: getSearchMatchLabel(matchedEntry.path),
    snippet: buildMatchSnippet(matchedEntry.text, normalizedQuery),
  }
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

function formatRecordedDateTime(iso: string | null): string {
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

function readTranscriptionStatus(metadata: Record<string, unknown>): {
  value: Exclude<StatusFilterValue, 'all'>
  label: string
  tone: StatusTone
} {
  const status = readMetadataTranscriptionStatus(metadata)

  if (status && COMPLETED_TRANSCRIPTION_STATUSES.has(status)) {
    return { value: 'transcribed', label: 'Transcribed', tone: 'success' }
  }

  if (status && PENDING_TRANSCRIPTION_STATUSES.has(status)) {
    return { value: 'processing', label: 'Processing', tone: 'warning' }
  }

  if (status && FAILED_TRANSCRIPTION_STATUSES.has(status)) {
    return { value: 'failed', label: 'Failed', tone: 'danger' }
  }

  if (readMetadataTranscriptionText(metadata)) {
    return { value: 'transcribed', label: 'Transcribed', tone: 'success' }
  }

  return { value: 'no_transcript', label: 'No transcript', tone: 'muted' }
}

function highlightQuery(text: string, query: string): ReactNode {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return text

  const lowerText = text.toLowerCase()
  const pieces: Array<string | { mark: string }> = []
  let index = 0

  while (index < text.length) {
    const matchIndex = lowerText.indexOf(normalizedQuery, index)

    if (matchIndex === -1) {
      pieces.push(text.slice(index))
      break
    }

    if (matchIndex > index) {
      pieces.push(text.slice(index, matchIndex))
    }

    pieces.push({ mark: text.slice(matchIndex, matchIndex + normalizedQuery.length) })
    index = matchIndex + normalizedQuery.length
  }

  return pieces.map((piece, entryIndex) =>
    typeof piece === 'string' ? piece : <mark key={`${piece.mark}-${entryIndex}`}>{piece.mark}</mark>,
  )
}

export function AllRecordingsPage() {
  const navigate = useNavigate()

  const [isLoadingRecordings, setIsLoadingRecordings] = useState(false)
  const [recordingsError, setRecordingsError] = useState<string | null>(null)
  const [recordings, setRecordings] = useState<RecordingFile[]>([])

  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>('all')
  const [sortBy, setSortBy] = useState<SortOptionValue>('most_recent')

  const [isSelectMode, setIsSelectMode] = useState(false)
  const [selectedRecordingIds, setSelectedRecordingIds] = useState<Set<string>>(new Set())
  const [isDeletingRecordings, setIsDeletingRecordings] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const [deleteDialog, setDeleteDialog] = useState<{
    recordingIds: string[]
    title?: string
  } | null>(null)

  const selectAllCheckboxRef = useRef<HTMLInputElement | null>(null)

  const recordingsTarget = useMemo(() => getRecordingsTarget(), [])

  const loadRecordings = useCallback(async (): Promise<void> => {
    setIsLoadingRecordings(true)
    setRecordingsError(null)

    try {
      const next = await listRecordings(recordingsTarget)
      setRecordings(next)
    } catch (error) {
      setRecordingsError(getApiErrorMessage(error, 'Failed to load recordings.'))
    } finally {
      setIsLoadingRecordings(false)
    }
  }, [recordingsTarget])

  useEffect(() => {
    document.title = 'Sinas - Recordings'
  }, [])

  useEffect(() => {
    void loadRecordings()
  }, [loadRecordings])

  useEffect(() => {
    if (!deleteDialog) return

    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || isDeletingRecordings) return
      setDeleteDialog(null)
    }

    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('keydown', handleEscape)
    }
  }, [deleteDialog, isDeletingRecordings])

  const normalizedSearchQuery = searchQuery.trim().toLowerCase()
  const metadataEntriesByRecordingId = useMemo(() => {
    const index = new Map<string, MetadataSearchEntry[]>()

    recordings.forEach((recording) => {
      index.set(recording.id, buildMetadataSearchEntries(recording.metadata))
    })

    return index
  }, [recordings])

  const searchableTextByRecordingId = useMemo(() => {
    const index = new Map<string, string>()

    recordings.forEach((recording) => {
      const title = getRecordingTitle(recording)
      const metadataEntries = metadataEntriesByRecordingId.get(recording.id) ?? []
      const metadataSearchText = metadataEntries.map((entry) => entry.normalizedText).join(' ')
      const searchableText = normalizeSearchableText(`${title} ${recording.name} ${metadataSearchText}`)
      index.set(recording.id, searchableText)
    })

    return index
  }, [metadataEntriesByRecordingId, recordings])

  const filteredRecordings = useMemo(() => {
    const items = recordings.filter((recording) => {
      const searchableText = searchableTextByRecordingId.get(recording.id) ?? ''
      const matchesSearch = !normalizedSearchQuery || searchableText.includes(normalizedSearchQuery)

      if (!matchesSearch) return false
      if (statusFilter === 'all') return true

      const transcriptionStatus = readTranscriptionStatus(recording.metadata)
      return transcriptionStatus.value === statusFilter
    })

    return items.sort((left, right) => {
      if (sortBy === 'title_asc') {
        return getRecordingTitle(left).localeCompare(getRecordingTitle(right))
      }

      if (sortBy === 'title_desc') {
        return getRecordingTitle(right).localeCompare(getRecordingTitle(left))
      }

      const leftTimestamp = getRecordingSortTimestamp(left)
      const rightTimestamp = getRecordingSortTimestamp(right)

      if (sortBy === 'oldest') {
        return leftTimestamp - rightTimestamp
      }

      return rightTimestamp - leftTimestamp
    })
  }, [normalizedSearchQuery, recordings, searchableTextByRecordingId, sortBy, statusFilter])

  const selectedCount = selectedRecordingIds.size
  const visibleSelectedCount = filteredRecordings.reduce(
    (count, recording) => count + (selectedRecordingIds.has(recording.id) ? 1 : 0),
    0,
  )

  const hasVisibleRecordings = filteredRecordings.length > 0
  const allVisibleSelected = hasVisibleRecordings && visibleSelectedCount === filteredRecordings.length
  const someVisibleSelected = visibleSelectedCount > 0 && !allVisibleSelected
  const selectAllDisabled = !hasVisibleRecordings || isDeletingRecordings

  useEffect(() => {
    if (!selectAllCheckboxRef.current) return
    selectAllCheckboxRef.current.indeterminate = someVisibleSelected
  }, [someVisibleSelected])

  const toggleSelectMode = (): void => {
    if (isDeletingRecordings) return

    if (isSelectMode) {
      setIsSelectMode(false)
      setSelectedRecordingIds(new Set())
      return
    }

    setDeleteDialog(null)
    setIsSelectMode(true)
  }

  const toggleRecordingSelection = (recordingId: string): void => {
    setSelectedRecordingIds((current) => {
      const next = new Set(current)
      if (next.has(recordingId)) {
        next.delete(recordingId)
      } else {
        next.add(recordingId)
      }
      return next
    })
  }

  const toggleSelectAllVisible = (): void => {
    if (selectAllDisabled) return

    setSelectedRecordingIds((current) => {
      const next = new Set(current)
      const areAllVisibleSelected =
        filteredRecordings.length > 0 && filteredRecordings.every((recording) => next.has(recording.id))

      if (areAllVisibleSelected) {
        filteredRecordings.forEach((recording) => next.delete(recording.id))
      } else {
        filteredRecordings.forEach((recording) => next.add(recording.id))
      }

      return next
    })
  }

  const openDeleteDialogForSingleRecording = (recording: RecordingFile): void => {
    if (isSelectMode || isDeletingRecordings) return

    const title = getRecordingTitle(recording)
    setDeleteDialog({
      recordingIds: [recording.id],
      title,
    })
  }

  const openDeleteDialogForSelectedRecordings = (): void => {
    if (isDeletingRecordings) return

    const recordingIds = Array.from(selectedRecordingIds)
    if (recordingIds.length === 0) return

    setDeleteDialog({ recordingIds })
  }

  const closeDeleteDialog = (): void => {
    if (isDeletingRecordings) return
    setDeleteDialog(null)
  }

  const confirmDeleteRecordings = async (): Promise<void> => {
    if (!deleteDialog || isDeletingRecordings) return

    setActionError(null)
    setIsDeletingRecordings(true)

    const recordingsById = new Map(recordings.map((recording) => [recording.id, recording] as const))

    try {
      await Promise.all(
        deleteDialog.recordingIds.map((recordingId) => {
          const recording = recordingsById.get(recordingId)
          if (!recording) return Promise.resolve()

          return deleteRecording({
            namespace: recording.namespace,
            collection: recording.collection,
            name: recording.name,
          })
        }),
      )

      setSelectedRecordingIds((current) => {
        const next = new Set(current)
        deleteDialog.recordingIds.forEach((recordingId) => next.delete(recordingId))
        return next
      })
      setDeleteDialog(null)

      if (isSelectMode) {
        setIsSelectMode(false)
      }

      await loadRecordings()
    } catch (error) {
      setActionError(getApiErrorMessage(error, 'Could not delete recording.'))
    } finally {
      setIsDeletingRecordings(false)
    }
  }

  const statusFilterLabel =
    STATUS_FILTER_OPTIONS.find((option) => option.value === statusFilter)?.label ?? 'All statuses'
  const sortByLabel = SORT_OPTIONS.find((option) => option.value === sortBy)?.label ?? 'Most recent'

  return (
    <div className={`app-root ${styles.screen}`}>
      <main className={styles.main}>
        <header className={styles.header}>
          <button type='button' className={styles.backButton} onClick={() => void navigate('/')}>
            <ArrowLeft size={16} />
            Back
          </button>
          <h1 className={styles.title}>All recordings</h1>
          <p className={styles.subtitle}>
            {filteredRecordings.length} shown{filteredRecordings.length !== recordings.length ? ` • ${recordings.length} total` : ''}
          </p>
        </header>

        <section className={styles.controlsSection}>
          <div className={styles.searchField}>
            <Search size={16} className={styles.searchIcon} aria-hidden='true' />
            <input
              type='search'
              className={styles.searchInput}
              value={searchQuery}
              placeholder='Search recordings...'
              onChange={(event) => setSearchQuery(event.target.value)}
              aria-label='Search recordings'
            />
          </div>

          <div className={styles.filterRow}>
            <Select
              value={statusFilter}
              onChange={(nextValue) => setStatusFilter(nextValue as StatusFilterValue)}
              options={STATUS_FILTER_OPTIONS}
              className={styles.selectField}
            />
            <Select
              value={sortBy}
              onChange={(nextValue) => setSortBy(nextValue as SortOptionValue)}
              options={SORT_OPTIONS.map((option) => ({
                value: option.value,
                label: option.label,
              }))}
              className={styles.selectField}
            />
          </div>

          <div className={styles.metaRow}>
            <p className={styles.metaRowLabel}>
              {statusFilterLabel} • {sortByLabel}
            </p>

            {isSelectMode ? (
              <div className={styles.selectModeActions}>
                <label className={joinClasses(styles.selectAllToggle, selectAllDisabled && styles.selectAllToggleDisabled)}>
                  <span className={styles.selectCheckbox}>
                    <input
                      ref={selectAllCheckboxRef}
                      type='checkbox'
                      className={styles.selectCheckboxInput}
                      checked={allVisibleSelected}
                      onChange={toggleSelectAllVisible}
                      disabled={selectAllDisabled}
                      aria-label='Select all visible recordings'
                      aria-checked={someVisibleSelected ? 'mixed' : allVisibleSelected}
                    />
                    <span className={styles.selectCheckboxControl} aria-hidden='true' />
                  </span>
                </label>

                <span className={styles.selectCount}>{selectedCount} selected</span>

                {selectedCount > 0 ? (
                  <button
                    type='button'
                    className={styles.selectIconButton}
                    onClick={openDeleteDialogForSelectedRecordings}
                    disabled={isDeletingRecordings}
                    aria-label='Delete selected recordings'
                  >
                    <Trash2 size={17} />
                  </button>
                ) : null}

                <button
                  type='button'
                  className={styles.selectIconButton}
                  onClick={toggleSelectMode}
                  disabled={isDeletingRecordings}
                  aria-label='Exit selection mode'
                >
                  <X size={18} />
                </button>
              </div>
            ) : (
              <button
                type='button'
                className={styles.selectButton}
                onClick={toggleSelectMode}
                disabled={isDeletingRecordings}
              >
                Select
              </button>
            )}
          </div>
        </section>

        <section className={styles.listSection}>
          {actionError ? <p className={styles.errorText}>{actionError}</p> : null}
          {isLoadingRecordings ? <p className={styles.stateText}>Loading recordings...</p> : null}
          {!isLoadingRecordings && recordingsError ? <p className={styles.errorText}>{recordingsError}</p> : null}
          {!isLoadingRecordings && !recordingsError && filteredRecordings.length === 0 ? (
            <p className={styles.stateText}>
              {recordings.length === 0 ? 'No recordings yet.' : 'No recordings match your current search and filters.'}
            </p>
          ) : null}

          {!isLoadingRecordings && !recordingsError && filteredRecordings.length > 0 ? (
            <ul className={styles.list}>
              {filteredRecordings.map((recording) => {
                const title = getRecordingTitle(recording)
                const duration = formatRecordingDuration(readMetadataDurationMs(recording.metadata))
                const effectiveRecordedAt = buildEffectiveRecordedAt(
                  recording.metadata,
                  readMetadataRecordedAt(recording.metadata) ?? recording.updatedAt,
                )
                const recordedAtLabel = formatRecordedDateTime(effectiveRecordedAt)
                const transcriptionStatus = readTranscriptionStatus(recording.metadata)
                const statusClass = STATUS_CLASS_BY_TONE[transcriptionStatus.tone]
                const metadataEntries = metadataEntriesByRecordingId.get(recording.id) ?? []
                const matchReason = findSearchMatchReason(recording, normalizedSearchQuery, metadataEntries)

                return (
                  <li
                    key={recording.id}
                    className={joinClasses(
                      styles.listItem,
                      isSelectMode && styles.listItemSelectMode,
                    )}
                  >
                    {isSelectMode ? (
                      <label className={styles.selectCheckbox}>
                        <input
                          type='checkbox'
                          className={styles.selectCheckboxInput}
                          checked={selectedRecordingIds.has(recording.id)}
                          onChange={() => toggleRecordingSelection(recording.id)}
                          aria-label={`Select ${title}`}
                        />
                        <span className={styles.selectCheckboxControl} aria-hidden='true' />
                      </label>
                    ) : null}

                    <button
                      type='button'
                      className={styles.listItemButton}
                      onClick={() => {
                        if (isSelectMode) {
                          toggleRecordingSelection(recording.id)
                          return
                        }

                        void navigate(`/recordings/${recording.id}`, {
                          state: buildRecordingSourceState('/recordings'),
                        })
                      }}
                    >
                      <div className={styles.listItemContent}>
                        <p className={styles.listItemTitle}>{highlightQuery(title, searchQuery)}</p>
                        <p className={styles.listItemMeta}>
                          {duration}
                          {recordedAtLabel ? ` • ${recordedAtLabel}` : ''}
                        </p>
                        {matchReason ? (
                          <p className={styles.listItemMatchReason}>
                            Matched in {matchReason.label}: {highlightQuery(matchReason.snippet, searchQuery)}
                          </p>
                        ) : null}
                      </div>

                      <div className={styles.listItemTail}>
                        <span className={joinClasses(styles.statusBadge, statusClass)}>
                          {transcriptionStatus.label}
                        </span>

                      </div>
                    </button>

                    {!isSelectMode ? (
                      <button
                        type='button'
                        className={styles.deleteSingleButton}
                        onClick={() => openDeleteDialogForSingleRecording(recording)}
                        aria-label={`Delete ${title}`}
                        disabled={isDeletingRecordings}
                      >
                        <Trash2 size={16} />
                      </button>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          ) : null}
        </section>
      </main>

      {deleteDialog ? (
        <div className={styles.deleteDialogOverlay} onClick={closeDeleteDialog}>
          <div
            className={styles.deleteDialog}
            role='dialog'
            aria-modal='true'
            aria-labelledby='delete-recordings-title'
            aria-describedby='delete-recordings-description'
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id='delete-recordings-title' className={styles.deleteDialogTitle}>
              {deleteDialog.recordingIds.length > 1
                ? `Delete ${deleteDialog.recordingIds.length} recordings?`
                : 'Delete this recording?'}
            </h2>
            <p id='delete-recordings-description' className={styles.deleteDialogDescription}>
              {deleteDialog.recordingIds.length > 1
                ? 'This will permanently remove the selected recordings. This action cannot be undone.'
                : `This will permanently remove "${deleteDialog.title ?? 'this recording'}". This action cannot be undone.`}
            </p>

            <div className={styles.deleteDialogActions}>
              <button
                type='button'
                className={styles.deleteDialogCancelButton}
                onClick={closeDeleteDialog}
                disabled={isDeletingRecordings}
              >
                Cancel
              </button>
              <button
                type='button'
                className={styles.deleteDialogConfirmButton}
                onClick={() => void confirmDeleteRecordings()}
                disabled={isDeletingRecordings}
              >
                <Trash2 size={14} />
                {isDeletingRecordings ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
