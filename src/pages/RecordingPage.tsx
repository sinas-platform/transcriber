import { ArrowLeft, Check, ChevronDown, ChevronRight, Copy, Pencil, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { Sidebar } from '../components/Sidebar/Sidebar'
import { useAuth } from '../features/auth/use-auth'
import { getApiErrorMessage, getFriendlySetupError } from '../lib/api-errors'
import {
  listAgents,
  type AgentSummary,
} from '../lib/agents'
import {
  markAgentAsRecentlyUsed,
  readRecentAgentsByUser,
  sortAgentsByRecentUsage,
} from '../lib/agent-recency'
import { buildAgentPlaceholderMetaById, DEFAULT_AGENT_PLACEHOLDER_META } from '../lib/agent-placeholders'
import {
  buildRecordingBootstrapMessage,
  createChatWithAgent,
} from '../lib/chats'
import {
  deleteRecording,
  downloadRecordingContent,
  getRecordingsTarget,
  listRecordings,
  type RecordingFile,
} from '../lib/recordings'
import {
  deleteSavedTodo,
  extractAndPersistTodosForRecording,
  getTodoErrorMessage,
  listSavedTodosForRecording,
  updateSavedTodo,
  updateSavedTodoStatus,
  type SavedTodo,
} from '../lib/todos'
import { env } from '../lib/env'
import { buildRecordingSourceState, readRecordingSource } from '../lib/recording-navigation'
import { clearWorkspaceUrlInQuery } from '../lib/workspace'
import styles from './RecordingPage.module.scss'

type PageView = 'recording' | 'sidebar'
type RecordingMember = { name: string; role: string }
type TodoPriorityValue = '' | 'low' | 'medium' | 'high'
type TodoEditDraft = {
  task: string
  assignee: string
  dueDate: string
  priority: TodoPriorityValue
  notes: string
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

function readMetadataDetailsLocation(metadata: Record<string, unknown>): string | null {
  const value = metadata.details_location
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized || null
}

function readMetadataDetailsNotes(metadata: Record<string, unknown>): string | null {
  const value = metadata.details_notes
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized || null
}

function readMetadataDetailsMembers(metadata: Record<string, unknown>): RecordingMember[] {
  const value = metadata.details_members
  if (!Array.isArray(value)) return []

  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null

      const nameValue = (entry as { name?: unknown }).name
      const roleValue = (entry as { role?: unknown }).role
      const name = typeof nameValue === 'string' ? nameValue.trim() : ''
      const role = typeof roleValue === 'string' ? roleValue.trim() : ''

      if (!name && !role) return null
      return { name, role }
    })
    .filter((entry): entry is RecordingMember => Boolean(entry))
}

function formatDetailsDate(dateText: string | null): string | null {
  if (!dateText) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText)
  if (!match) return dateText

  const year = Number.parseInt(match[1], 10)
  const month = Number.parseInt(match[2], 10) - 1
  const day = Number.parseInt(match[3], 10)
  const parsed = new Date(year, month, day)
  if (Number.isNaN(parsed.getTime())) return dateText

  return parsed.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
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

function normalizeRecordingLabel(name: string): string {
  return name.replace(/\.[^.]+$/, '').replace(/^recording[-_]?/i, '').replace(/[-_]/g, ' ').trim() || name
}

function buildAgentChatTitle(recordingLabel: string, agentName: string): string {
  const label = recordingLabel.trim() || 'Recording'
  const agent = agentName.trim() || 'Agent'
  const rawTitle = `${label} • ${agent}`

  return rawTitle.length > 96 ? `${rawTitle.slice(0, 95)}…` : rawTitle
}

function base64ToBlob(base64: string, contentType: string): Blob {
  const binary = window.atob(base64)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return new Blob([bytes], { type: contentType })
}

function encodeAudioBufferAsWav(audioBuffer: AudioBuffer): Blob {
  const channels = audioBuffer.numberOfChannels
  const sampleRate = audioBuffer.sampleRate
  const frameCount = audioBuffer.length
  const bytesPerSample = 2
  const blockAlign = channels * bytesPerSample
  const byteRate = sampleRate * blockAlign
  const dataSize = frameCount * blockAlign
  const wavBuffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(wavBuffer)

  let offset = 0
  const writeAscii = (value: string): void => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset, value.charCodeAt(index))
      offset += 1
    }
  }

  writeAscii('RIFF')
  view.setUint32(offset, 36 + dataSize, true)
  offset += 4
  writeAscii('WAVE')
  writeAscii('fmt ')
  view.setUint32(offset, 16, true)
  offset += 4
  view.setUint16(offset, 1, true)
  offset += 2
  view.setUint16(offset, channels, true)
  offset += 2
  view.setUint32(offset, sampleRate, true)
  offset += 4
  view.setUint32(offset, byteRate, true)
  offset += 4
  view.setUint16(offset, blockAlign, true)
  offset += 2
  view.setUint16(offset, bytesPerSample * 8, true)
  offset += 2
  writeAscii('data')
  view.setUint32(offset, dataSize, true)
  offset += 4

  const channelData = Array.from({ length: channels }, (_, channelIndex) =>
    audioBuffer.getChannelData(channelIndex),
  )

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    for (let channelIndex = 0; channelIndex < channels; channelIndex += 1) {
      const sample = Math.max(-1, Math.min(1, channelData[channelIndex][frameIndex] ?? 0))
      const pcm = sample < 0 ? sample * 0x8000 : sample * 0x7fff
      view.setInt16(offset, pcm, true)
      offset += 2
    }
  }

  return new Blob([wavBuffer], { type: 'audio/wav' })
}

async function buildSeekablePlaybackBlob(sourceBlob: Blob): Promise<Blob> {
  if (typeof AudioContext === 'undefined') {
    return sourceBlob
  }

  const audioContext = new AudioContext()

  try {
    const sourceBytes = await sourceBlob.arrayBuffer()
    const decoded = await audioContext.decodeAudioData(sourceBytes.slice(0))
    return encodeAudioBufferAsWav(decoded)
  } catch {
    return sourceBlob
  } finally {
    void audioContext.close()
  }
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

function readMetadataTranscriptionError(metadata: Record<string, unknown>): string | null {
  const value = metadata.transcription_error
  if (typeof value !== 'string' || !value.trim()) return null
  return value
}

function isPendingTranscriptionStatus(status: string | null): boolean {
  if (!status) return false
  return status === 'pending' || status === 'queued' || status === 'processing' || status === 'running'
}

function normalizeComparableText(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

function findTodoAgent(agents: AgentSummary[]): AgentSummary | null {
  const configuredNamespace = normalizeComparableText(env('VITE_TODO_AGENT_NAMESPACE'))
  const configuredName = normalizeComparableText(env('VITE_TODO_AGENT_NAME'))

  if (configuredNamespace && configuredName) {
    const configuredMatch = agents.find(
      (agent) =>
        normalizeComparableText(agent.namespace) === configuredNamespace &&
        normalizeComparableText(agent.name) === configuredName,
    )
    if (configuredMatch) return configuredMatch
  }

  const keywordPatterns = [/to[-\s]?do/, /action\s*items?/, /\btasks?\b/]

  return (
    agents.find((agent) => {
      const searchable = `${normalizeComparableText(agent.name)} ${normalizeComparableText(agent.description)}`
      return keywordPatterns.some((pattern) => pattern.test(searchable))
    }) ?? null
  )
}

function formatSavedTodoDueDate(value: string | null): string | null {
  if (!value) return null

  const trimmed = value.trim()
  if (!trimmed) return null

  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed)
  if (dateOnlyMatch) {
    const year = Number.parseInt(dateOnlyMatch[1], 10)
    const monthIndex = Number.parseInt(dateOnlyMatch[2], 10) - 1
    const day = Number.parseInt(dateOnlyMatch[3], 10)
    const parsed = new Date(year, monthIndex, day)

    if (!Number.isNaN(parsed.getTime())) {
      return `${String(day).padStart(2, '0')}.${String(monthIndex + 1).padStart(2, '0')}.${year}`
    }
  }

  const europeanMatch = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(trimmed)
  if (europeanMatch) {
    const day = Number.parseInt(europeanMatch[1], 10)
    const month = Number.parseInt(europeanMatch[2], 10)
    const year = Number.parseInt(europeanMatch[3], 10)
    const parsed = new Date(year, month - 1, day)
    if (!Number.isNaN(parsed.getTime())) {
      return `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.${year}`
    }
  }

  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) return trimmed

  return `${String(parsed.getDate()).padStart(2, '0')}.${String(parsed.getMonth() + 1).padStart(2, '0')}.${parsed.getFullYear()} ${String(parsed.getHours()).padStart(2, '0')}:${String(parsed.getMinutes()).padStart(2, '0')}`
}

function formatDueDateForInput(value: string | null): string {
  const formatted = formatSavedTodoDueDate(value)
  return formatted ? formatted.split(' ')[0] : ''
}

function buildSavedTodoMeta(todo: SavedTodo): string {
  const parts: string[] = [todo.value.status === 'done' ? 'Done' : 'Open']

  if (todo.value.assignee) {
    parts.push(`Assignee: ${todo.value.assignee}`)
  }

  const dueLabel = formatSavedTodoDueDate(todo.value.due_date)
  if (dueLabel) {
    parts.push(`Due: ${dueLabel}`)
  }

  if (todo.value.priority) {
    parts.push(`Priority: ${todo.value.priority}`)
  }

  return parts.join(' • ')
}

function sortSavedTodosForUi(todos: SavedTodo[]): SavedTodo[] {
  const openTodos = todos.filter((todo) => todo.value.status === 'open')
  const doneTodos = todos.filter((todo) => todo.value.status === 'done')
  return [...openTodos, ...doneTodos]
}

function buildTodoEditDraft(todo: SavedTodo): TodoEditDraft {
  return {
    task: todo.value.task,
    assignee: todo.value.assignee ?? '',
    dueDate: formatDueDateForInput(todo.value.due_date),
    priority: todo.value.priority ?? '',
    notes: todo.value.notes ?? '',
  }
}

export function RecordingPage() {
  const { logout, session } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const { recordingId } = useParams<{ recordingId: string }>()
  const recordingSource = readRecordingSource(location.state)
  const backTarget = recordingSource ?? '/'
  const recordingSourceState = buildRecordingSourceState(backTarget)
  const returnLinkLabel = backTarget === '/recordings' ? 'Return to all recordings' : 'Return to recorder'

  const [view, setView] = useState<PageView>('recording')
  const [isLoadingRecordings, setIsLoadingRecordings] = useState(false)
  const [recordingsError, setRecordingsError] = useState<string | null>(null)
  const [recordings, setRecordings] = useState<RecordingFile[]>([])

  const [isLoadingRecording, setIsLoadingRecording] = useState(false)
  const [recordingError, setRecordingError] = useState<string | null>(null)
  const [selectedRecording, setSelectedRecording] = useState<RecordingFile | null>(null)
  const [playbackTarget, setPlaybackTarget] = useState<
    Pick<RecordingFile, 'namespace' | 'collection' | 'name' | 'currentVersion'> | null
  >(null)
  const [selectedRecordingUrl, setSelectedRecordingUrl] = useState<string | null>(null)
  const [recordingUrlError, setRecordingUrlError] = useState<string | null>(null)
  const [isLoadingRecordingUrl, setIsLoadingRecordingUrl] = useState(false)

  const [transcription, setTranscription] = useState<string | null>(null)
  const [transcriptionError, setTranscriptionError] = useState<string | null>(null)
  const [isGeneratingTranscription, setIsGeneratingTranscription] = useState(false)
  const [isTranscriptionExpanded, setIsTranscriptionExpanded] = useState(false)
  const [isAudioExpanded, setIsAudioExpanded] = useState(true)
  const [isTranscriptionSectionExpanded, setIsTranscriptionSectionExpanded] = useState(true)
  const [hasCopiedTranscription, setHasCopiedTranscription] = useState(false)

  const [availableAgents, setAvailableAgents] = useState<AgentSummary[]>([])
  const [isLoadingAgents, setIsLoadingAgents] = useState(false)
  const [agentsError, setAgentsError] = useState<string | null>(null)
  const [agentChatError, setAgentChatError] = useState<string | null>(null)
  const [isOpeningAgentChatId, setIsOpeningAgentChatId] = useState<string | null>(null)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isDeletingRecording, setIsDeletingRecording] = useState(false)
  const [deleteRecordingError, setDeleteRecordingError] = useState<string | null>(null)
  const [isRegenerateDialogOpen, setIsRegenerateDialogOpen] = useState(false)
  const [pendingTodoDelete, setPendingTodoDelete] = useState<SavedTodo | null>(null)
  const [isDeletingTodo, setIsDeletingTodo] = useState(false)
  const [savedTodos, setSavedTodos] = useState<SavedTodo[]>([])
  const [isLoadingSavedTodos, setIsLoadingSavedTodos] = useState(false)
  const [savedTodosError, setSavedTodosError] = useState<string | null>(null)
  const [isExtractingTodos, setIsExtractingTodos] = useState(false)
  const [todoExtractionSummary, setTodoExtractionSummary] = useState<string | null>(null)
  const [updatingTodoKey, setUpdatingTodoKey] = useState<string | null>(null)
  const [editingTodoKey, setEditingTodoKey] = useState<string | null>(null)
  const [todoEditDraft, setTodoEditDraft] = useState<TodoEditDraft | null>(null)

  const playbackObjectUrlRef = useRef<string | null>(null)
  const copyResetTimeoutRef = useRef<number | null>(null)

  const recordingsTarget = useMemo(() => getRecordingsTarget(), [])
  const placeholderByAgentId = useMemo(() => buildAgentPlaceholderMetaById(availableAgents), [availableAgents])

  const selectedRecordingLabel = useMemo(() => {
    if (!selectedRecording) return ''
    return readMetadataTitle(selectedRecording.metadata) || normalizeRecordingLabel(selectedRecording.name)
  }, [selectedRecording])

  const selectedRecordingDuration = useMemo(() => {
    if (!selectedRecording) return '--:--'
    return formatRecordingDuration(readMetadataDurationMs(selectedRecording.metadata))
  }, [selectedRecording])

  const selectedRecordingTimestamp = useMemo(() => {
    if (!selectedRecording) return ''
    const fallbackRecordedAt = readMetadataRecordedAt(selectedRecording.metadata) ?? selectedRecording.updatedAt
    const effectiveRecordedAt = buildEffectiveRecordedAt(selectedRecording.metadata, fallbackRecordedAt)
    return formatRecordedDateTime(effectiveRecordedAt)
  }, [selectedRecording])

  const selectedRecordingDetails = useMemo(() => {
    if (!selectedRecording) {
      return {
        date: null,
        time: null,
        location: null,
        notes: null,
        members: [] as RecordingMember[],
        hasAny: false,
      }
    }

    const metadata = selectedRecording.metadata
    const date = formatDetailsDate(readMetadataDetailsDate(metadata))
    const time = readMetadataDetailsTime(metadata)
    const location = readMetadataDetailsLocation(metadata)
    const notes = readMetadataDetailsNotes(metadata)
    const members = readMetadataDetailsMembers(metadata)
    const hasAny = Boolean(date || time || location || notes || members.length > 0)

    return {
      date,
      time,
      location,
      notes,
      members,
      hasAny,
    }
  }, [selectedRecording])

  const canExpandTranscription = Boolean(transcription && transcription.length > 320)
  const hasSavedTodos = savedTodos.length > 0

  const clearCopyResetTimer = (): void => {
    if (copyResetTimeoutRef.current !== null) {
      window.clearTimeout(copyResetTimeoutRef.current)
      copyResetTimeoutRef.current = null
    }
  }

  const revokePlaybackObjectUrl = (): void => {
    if (!playbackObjectUrlRef.current) return

    URL.revokeObjectURL(playbackObjectUrlRef.current)
    playbackObjectUrlRef.current = null
  }

  const loadRecordings = useCallback(async (): Promise<RecordingFile[]> => {
    setIsLoadingRecordings(true)
    setRecordingsError(null)

    try {
      const next = await listRecordings(recordingsTarget)
      setRecordings(next)
      return next
    } catch (error) {
      setRecordingsError(
        getApiErrorMessage(error, 'Failed to load recordings.', { configErrorTarget: 'recordings' }),
      )
      throw error
    } finally {
      setIsLoadingRecordings(false)
    }
  }, [recordingsTarget])

  const loadSavedTodos = useCallback(async (nextRecordingId: string): Promise<void> => {
    setIsLoadingSavedTodos(true)
    setSavedTodosError(null)

    try {
      const todos = await listSavedTodosForRecording(nextRecordingId)
      setSavedTodos(sortSavedTodosForUi(todos))
      setEditingTodoKey(null)
      setTodoEditDraft(null)
    } catch (error) {
      setSavedTodosError(getTodoErrorMessage(error, 'Could not load saved to-dos.'))
      setSavedTodos([])
      setEditingTodoKey(null)
      setTodoEditDraft(null)
    } finally {
      setIsLoadingSavedTodos(false)
    }
  }, [])

  useEffect(() => {
    let isCancelled = false

    const loadRecording = async (): Promise<void> => {
      setView('recording')
      setRecordingError(null)
      setSelectedRecording(null)
      setPlaybackTarget(null)
      setSelectedRecordingUrl(null)
      setRecordingUrlError(null)
      setTranscription(null)
      setTranscriptionError(null)
      setIsGeneratingTranscription(false)
      setIsTranscriptionExpanded(false)
      setIsAudioExpanded(true)
      setIsTranscriptionSectionExpanded(true)
      setHasCopiedTranscription(false)
      clearCopyResetTimer()
      setAvailableAgents([])
      setAgentsError(null)
      setAgentChatError(null)
      setIsOpeningAgentChatId(null)
      setIsDeleteDialogOpen(false)
      setIsDeletingRecording(false)
      setDeleteRecordingError(null)
      setIsRegenerateDialogOpen(false)
      setPendingTodoDelete(null)
      setIsDeletingTodo(false)
      setSavedTodos([])
      setIsLoadingSavedTodos(false)
      setSavedTodosError(null)
      setIsExtractingTodos(false)
      setTodoExtractionSummary(null)
      setUpdatingTodoKey(null)
      setEditingTodoKey(null)
      setTodoEditDraft(null)
      revokePlaybackObjectUrl()

      if (!recordingId) {
        setRecordingError('Recording was not found.')
        setIsLoadingRecording(false)
        return
      }

      setIsLoadingRecording(true)

      try {
        const nextRecordings = await loadRecordings()
        if (isCancelled) return

        const nextSelectedRecording = nextRecordings.find((recording) => recording.id === recordingId)
        if (!nextSelectedRecording) {
          setRecordingError('Recording was not found.')
          return
        }

        setSelectedRecording(nextSelectedRecording)
        setPlaybackTarget({
          namespace: nextSelectedRecording.namespace,
          collection: nextSelectedRecording.collection,
          name: nextSelectedRecording.name,
          currentVersion: nextSelectedRecording.currentVersion,
        })
      } catch (error) {
        if (isCancelled) return
        setRecordingError(
          getApiErrorMessage(error, 'Failed to load the recording.', { configErrorTarget: 'recordings' }),
        )
      } finally {
        if (!isCancelled) {
          setIsLoadingRecording(false)
        }
      }
    }

    void loadRecording()

    return () => {
      isCancelled = true
    }
  }, [loadRecordings, recordingId])

  const selectedRecordingId = selectedRecording?.id ?? null

  useEffect(() => {
    if (!selectedRecordingId) {
      setIsRegenerateDialogOpen(false)
      setPendingTodoDelete(null)
      setIsDeletingTodo(false)
      setSavedTodos([])
      setSavedTodosError(null)
      setIsLoadingSavedTodos(false)
      setEditingTodoKey(null)
      setTodoEditDraft(null)
      return
    }

    void loadSavedTodos(selectedRecordingId)
  }, [loadSavedTodos, selectedRecordingId])

  useEffect(() => {
    if (!selectedRecordingId || !playbackTarget) {
      return
    }

    let isCancelled = false

    const loadDetails = async (): Promise<void> => {
      setIsLoadingRecordingUrl(true)
      setSelectedRecordingUrl(null)
      setRecordingUrlError(null)
      setIsTranscriptionExpanded(false)
      setAgentsError(null)
      setAgentChatError(null)
      setIsOpeningAgentChatId(null)
      setIsLoadingAgents(true)
      revokePlaybackObjectUrl()

      const [audioResult, agentsResult] = await Promise.allSettled([
        (async () => {
          const downloaded = await downloadRecordingContent(playbackTarget)
          const sourceBlob = base64ToBlob(downloaded.contentBase64, downloaded.contentType || 'audio/webm')
          const seekableBlob = await buildSeekablePlaybackBlob(sourceBlob)
          return URL.createObjectURL(seekableBlob)
        })(),
        listAgents(),
      ])

      if (isCancelled) {
        if (audioResult.status === 'fulfilled') {
          URL.revokeObjectURL(audioResult.value)
        }
        return
      }

      if (audioResult.status === 'fulfilled') {
        playbackObjectUrlRef.current = audioResult.value
        setSelectedRecordingUrl(audioResult.value)
      } else {
        setSelectedRecordingUrl(null)
        setRecordingUrlError(
          getApiErrorMessage(audioResult.reason, 'Could not load the recording audio.', {
            configErrorTarget: 'recordings',
          }),
        )
      }
      setIsLoadingRecordingUrl(false)

      if (agentsResult.status === 'rejected') {
        setAvailableAgents([])
        setAgentsError(getApiErrorMessage(agentsResult.reason, 'Could not load available agents.'))
        setIsLoadingAgents(false)
        return
      }

      const recentAgentsByUser = readRecentAgentsByUser(session?.user.id)
      const activeAgents = sortAgentsByRecentUsage(
        agentsResult.value.filter((agent) => agent.isActive),
        recentAgentsByUser,
      )
      setAvailableAgents(activeAgents)
      setIsLoadingAgents(false)
    }

    void loadDetails()

    return () => {
      isCancelled = true
    }
  }, [playbackTarget, selectedRecordingId, session?.user.id])

  useEffect(() => {
    if (!selectedRecording) return

    const transcriptionText = readMetadataTranscriptionText(selectedRecording.metadata)
    const transcriptionStatus = readMetadataTranscriptionStatus(selectedRecording.metadata)
    const transcriptionFailure = readMetadataTranscriptionError(selectedRecording.metadata)

    if (transcriptionText) {
      setTranscription(transcriptionText)
      setTranscriptionError(null)
      setIsGeneratingTranscription(false)
      return
    }

    if (transcriptionFailure || transcriptionStatus === 'failed') {
      setTranscription(null)
      setTranscriptionError(transcriptionFailure || 'Background transcription failed for this recording.')
      setIsGeneratingTranscription(false)
      return
    }

    if (isPendingTranscriptionStatus(transcriptionStatus)) {
      setTranscription(null)
      setTranscriptionError(null)
      setIsGeneratingTranscription(true)
      return
    }

    setTranscription(null)
    setTranscriptionError(null)
    setIsGeneratingTranscription(false)
  }, [selectedRecording])

  useEffect(() => {
    if (!selectedRecordingId) return

    const status = readMetadataTranscriptionStatus(selectedRecording?.metadata ?? {})
    const text = readMetadataTranscriptionText(selectedRecording?.metadata ?? {})
    const error = readMetadataTranscriptionError(selectedRecording?.metadata ?? {})

    if (text || error || status === 'failed' || !isPendingTranscriptionStatus(status)) return

    let isCancelled = false
    let timeoutId: number | null = null
    let attempts = 0
    const maxAttempts = 30
    const pollIntervalMs = 3000

    setIsGeneratingTranscription(true)

    const pollLatest = async (): Promise<void> => {
      attempts += 1

      try {
        const nextRecordings = await listRecordings(recordingsTarget)
        if (isCancelled) return

        setRecordings(nextRecordings)
        const latest = nextRecordings.find((recording) => recording.id === selectedRecordingId)

        if (!latest) {
          setIsGeneratingTranscription(false)
          return
        }

        setSelectedRecording(latest)
        const latestText = readMetadataTranscriptionText(latest.metadata)
        const latestError = readMetadataTranscriptionError(latest.metadata)
        const latestStatus = readMetadataTranscriptionStatus(latest.metadata)
        const isDone = Boolean(latestText || latestError || latestStatus === 'failed')

        if (isDone) {
          setIsGeneratingTranscription(false)
          return
        }
      } catch (error) {
        const setupMessage = getFriendlySetupError(error, 'recordings')
        if (setupMessage) {
          setRecordingsError(setupMessage)
          setIsGeneratingTranscription(false)
          return
        }

        // Polling errors should not break the page; keep the latest visible state.
      }

      if (attempts < maxAttempts && !isCancelled) {
        timeoutId = window.setTimeout(() => {
          void pollLatest()
        }, pollIntervalMs)
      } else {
        setIsGeneratingTranscription(false)
      }
    }

    timeoutId = window.setTimeout(() => {
      void pollLatest()
    }, pollIntervalMs)

    return () => {
      isCancelled = true
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [recordingsTarget, selectedRecordingId])
  useEffect(() => {
    if (!isDeleteDialogOpen) return

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || isDeletingRecording) return
      setIsDeleteDialogOpen(false)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isDeleteDialogOpen, isDeletingRecording])

  useEffect(() => {
    if (!pendingTodoDelete) return

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || isDeletingTodo) return
      setPendingTodoDelete(null)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [pendingTodoDelete, isDeletingTodo])

  useEffect(() => {
    if (!isRegenerateDialogOpen) return

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || isExtractingTodos) return
      setIsRegenerateDialogOpen(false)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isRegenerateDialogOpen, isExtractingTodos])

  useEffect(() => {
    return () => {
      revokePlaybackObjectUrl()
      clearCopyResetTimer()
    }
  }, [])

  const copyTranscription = async (): Promise<void> => {
    if (!transcription || !navigator.clipboard?.writeText) return

    try {
      await navigator.clipboard.writeText(transcription)
      setHasCopiedTranscription(true)
      clearCopyResetTimer()
      copyResetTimeoutRef.current = window.setTimeout(() => {
        setHasCopiedTranscription(false)
      }, 1800)
    } catch {
      setHasCopiedTranscription(false)
    }
  }

  const openAgentChat = async (agent: AgentSummary): Promise<void> => {
    if (!selectedRecording || isOpeningAgentChatId) return

    const transcriptionText = transcription?.trim() || ''
    if (!transcriptionText) {
      if (isGeneratingTranscription) {
        setAgentChatError('Transcription is still being generated. Please wait a moment and try again.')
      } else {
        setAgentChatError('Transcription is not available for this recording yet.')
      }
      return
    }

    setAgentChatError(null)
    setIsOpeningAgentChatId(agent.id)

    try {
      const chatTitle = buildAgentChatTitle(selectedRecordingLabel, agent.name)
      const chat = await createChatWithAgent(agent.namespace, agent.name, {
        title: chatTitle,
        input: {},
      })
      const recentAgentsByUser = markAgentAsRecentlyUsed(agent.id, session?.user.id)
      setAvailableAgents((current) => sortAgentsByRecentUsage(current, recentAgentsByUser))

      const bootstrapMessage = buildRecordingBootstrapMessage(selectedRecordingLabel, transcriptionText)
      void navigate(
        {
          pathname: `/recordings/${selectedRecording.id}/chats/${chat.id}`,
          search: location.search,
        },
        {
          state: {
            initialContent: bootstrapMessage,
            ...recordingSourceState,
          },
        },
      )
    } catch (error) {
      setAgentChatError(getApiErrorMessage(error, 'Could not open chat with this agent.'))
    } finally {
      setIsOpeningAgentChatId(null)
    }
  }

  const extractAndSaveTodos = async (skipRegenerateConfirm = false): Promise<void> => {
    if (!selectedRecordingId || !selectedRecording || isExtractingTodos) return

    const transcriptionText = transcription?.trim() || ''
    if (!transcriptionText) {
      if (isGeneratingTranscription) {
        setSavedTodosError('Transcription is still being generated. Please wait before extracting to-dos.')
      } else {
        setSavedTodosError('Transcription is not available for this recording yet.')
      }
      return
    }

    const todoAgent = findTodoAgent(availableAgents)
    if (!todoAgent) {
      setSavedTodosError(
        'No to-do agent is available. Activate one, or set VITE_TODO_AGENT_NAMESPACE and VITE_TODO_AGENT_NAME.',
      )
      return
    }

    if (hasSavedTodos && !skipRegenerateConfirm) {
      setIsRegenerateDialogOpen(true)
      return
    }

    setIsExtractingTodos(true)
    setSavedTodosError(null)
    setTodoExtractionSummary(null)

    try {
      const result = await extractAndPersistTodosForRecording({
        recordingId: selectedRecordingId,
        recordingTitle: selectedRecordingLabel,
        transcription: transcriptionText,
        agentNamespace: todoAgent.namespace,
        agentName: todoAgent.name,
      })

      setSavedTodos(sortSavedTodosForUi(result.savedTodos))
      setEditingTodoKey(null)
      setTodoEditDraft(null)

      const summaryParts = [`Created ${result.createdCount} new to-dos.`, `Skipped ${result.duplicateCount} duplicates.`]
      if (result.invalidCount > 0) {
        summaryParts.push(`Ignored ${result.invalidCount} invalid item${result.invalidCount === 1 ? '' : 's'}.`)
      }

      setTodoExtractionSummary(summaryParts.join(' '))
    } catch (error) {
      setSavedTodosError(getTodoErrorMessage(error, 'Could not generate and save to-dos.'))
    } finally {
      setIsExtractingTodos(false)
    }
  }

  const closeRegenerateDialog = (): void => {
    if (isExtractingTodos) return
    setIsRegenerateDialogOpen(false)
  }

  const confirmRegenerateTodos = async (): Promise<void> => {
    if (isExtractingTodos) return
    setIsRegenerateDialogOpen(false)
    await extractAndSaveTodos(true)
  }

  const toggleSavedTodoStatus = async (todo: SavedTodo): Promise<void> => {
    if (updatingTodoKey || editingTodoKey === todo.key) return

    setUpdatingTodoKey(todo.key)
    setSavedTodosError(null)
    setTodoExtractionSummary(null)

    try {
      const nextStatus = todo.value.status === 'done' ? 'open' : 'done'
      const updated = await updateSavedTodoStatus(todo, nextStatus)

      setSavedTodos((current) => sortSavedTodosForUi(current.map((entry) => (entry.key === updated.key ? updated : entry))))
    } catch (error) {
      setSavedTodosError(getTodoErrorMessage(error, 'Could not update to-do status.'))
    } finally {
      setUpdatingTodoKey(null)
    }
  }

  const startEditingTodo = (todo: SavedTodo): void => {
    if (updatingTodoKey || isExtractingTodos) return
    setSavedTodosError(null)
    setTodoExtractionSummary(null)
    setEditingTodoKey(todo.key)
    setTodoEditDraft(buildTodoEditDraft(todo))
  }

  const cancelEditingTodo = (): void => {
    if (updatingTodoKey) return
    setEditingTodoKey(null)
    setTodoEditDraft(null)
  }

  const saveEditedTodo = async (): Promise<void> => {
    if (!editingTodoKey || !todoEditDraft || updatingTodoKey) return

    const targetTodo = savedTodos.find((entry) => entry.key === editingTodoKey)
    if (!targetTodo) {
      setEditingTodoKey(null)
      setTodoEditDraft(null)
      return
    }

    const nextTask = todoEditDraft.task.trim()
    if (!nextTask) {
      setSavedTodosError('To-do title is required.')
      return
    }

    setUpdatingTodoKey(targetTodo.key)
    setSavedTodosError(null)
    setTodoExtractionSummary(null)

    try {
      const updated = await updateSavedTodo(targetTodo, {
        task: nextTask,
        assignee: todoEditDraft.assignee.trim() || null,
        due_date: todoEditDraft.dueDate.trim() || null,
        priority: todoEditDraft.priority || null,
        notes: todoEditDraft.notes.trim() || null,
      })

      setSavedTodos((current) =>
        sortSavedTodosForUi(
          current.map((entry) => (entry.key === targetTodo.key ? updated : entry)),
        ),
      )
      setEditingTodoKey(null)
      setTodoEditDraft(null)
    } catch (error) {
      setSavedTodosError(getTodoErrorMessage(error, 'Could not save to-do changes.'))
    } finally {
      setUpdatingTodoKey(null)
    }
  }

  const removeSavedTodo = (todo: SavedTodo): void => {
    if (updatingTodoKey || isDeletingTodo) return
    setSavedTodosError(null)
    setTodoExtractionSummary(null)
    setPendingTodoDelete(todo)
  }

  const closeTodoDeleteDialog = (): void => {
    if (isDeletingTodo) return
    setPendingTodoDelete(null)
  }

  const confirmDeleteTodo = async (): Promise<void> => {
    if (!pendingTodoDelete || isDeletingTodo) return

    const todo = pendingTodoDelete
    setUpdatingTodoKey(todo.key)
    setIsDeletingTodo(true)
    setSavedTodosError(null)
    setTodoExtractionSummary(null)

    try {
      await deleteSavedTodo(todo)
      setSavedTodos((current) => current.filter((entry) => entry.key !== todo.key))
      setPendingTodoDelete(null)

      if (editingTodoKey === todo.key) {
        setEditingTodoKey(null)
        setTodoEditDraft(null)
      }
    } catch (error) {
      setSavedTodosError(getTodoErrorMessage(error, 'Could not delete to-do.'))
    } finally {
      setIsDeletingTodo(false)
      setUpdatingTodoKey(null)
    }
  }

  const openDeleteDialog = (): void => {
    if (isDeletingRecording) return
    setDeleteRecordingError(null)
    setIsDeleteDialogOpen(true)
  }

  const closeDeleteDialog = (): void => {
    if (isDeletingRecording) return
    setIsDeleteDialogOpen(false)
  }

  const handleLogout = (): void => {
    clearWorkspaceUrlInQuery()
    logout()
  }

  const confirmDeleteRecording = async (): Promise<void> => {
    if (!selectedRecording || isDeletingRecording) return

    setDeleteRecordingError(null)
    setIsDeletingRecording(true)

    try {
      await deleteRecording({
        namespace: selectedRecording.namespace,
        collection: selectedRecording.collection,
        name: selectedRecording.name,
      })

      setIsDeleteDialogOpen(false)
      void navigate({ pathname: backTarget, search: location.search }, { replace: true })
    } catch (error) {
      setDeleteRecordingError(
        getApiErrorMessage(error, 'Could not delete this recording.', { configErrorTarget: 'recordings' }),
      )
    } finally {
      setIsDeletingRecording(false)
    }
  }

  if (view === 'sidebar') {
    return (
      <Sidebar
        isLoadingRecordings={isLoadingRecordings}
        recordingsError={recordingsError}
        recordings={recordings}
        userEmail={session?.user.email}
        onClose={() => setView('recording')}
        onNewRecording={() => {
          setView('recording')
          void navigate({ pathname: '/', search: location.search })
        }}
        onSelectRecording={(recording) => {
          setView('recording')
          void navigate(
            {
              pathname: `/recordings/${recording.id}`,
              search: location.search,
            },
            {
              state: recordingSourceState,
            },
          )
        }}
        onViewAllRecordings={() => {
          setView('recording')
          void navigate({ pathname: '/recordings', search: location.search })
        }}
        onOpenSettings={() => {
          setView('recording')
          void navigate({ pathname: '/settings', search: location.search })
        }}
        onLogout={handleLogout}
      />
    )
  }

  return (
    <div className={`app-root ${styles.screen}`}>
      <main className={styles.recordingDetailsMain}>
        {isLoadingRecording ? (
          <section className={styles.detailSection}>
            <p className={styles.sectionState}>Loading recording...</p>
          </section>
        ) : null}

        {!isLoadingRecording && recordingError ? (
          <section className={styles.detailSection}>
            <p className={styles.sectionError}>{recordingError}</p>
            <button
              type='button'
              className={styles.sectionLinkButton}
              onClick={() => void navigate({ pathname: backTarget, search: location.search })}
            >
              {returnLinkLabel}
            </button>
          </section>
        ) : null}

        {!isLoadingRecording && !recordingError && selectedRecording ? (
          <>
            <section className={styles.pageHeaderSection}>
              <button
                type='button'
                className={styles.backButton}
                onClick={() => void navigate({ pathname: backTarget, search: location.search })}
              >
                <ArrowLeft size={16} />
                Back
              </button>

              <div className={styles.pageHeaderRow}>
                <h1 className={styles.pageTitle}>{selectedRecordingLabel}</h1>
                <div className={styles.pageHeaderActions}>
                  <button
                    type='button'
                    className={styles.editDetailsButton}
                    onClick={() =>
                      void navigate(
                        {
                          pathname: `/recordings/${selectedRecording.id}/details/edit`,
                          search: location.search,
                        },
                        {
                          state: recordingSourceState,
                        },
                      )
                    }
                    aria-label='Edit recording details'
                    disabled={isDeletingRecording}
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    type='button'
                    className={styles.deleteRecordingButton}
                    onClick={openDeleteDialog}
                    aria-label='Delete recording'
                    disabled={isDeletingRecording}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
              <p className={styles.pageMeta}>
                {selectedRecordingDuration}
                {selectedRecordingTimestamp ? ` • ${selectedRecordingTimestamp}` : ''}
              </p>
              {deleteRecordingError ? <p className={styles.sectionError}>{deleteRecordingError}</p> : null}
            </section>

            <section className={styles.detailSection}>
              <h2 className={styles.sectionTitle}>Details</h2>

              {selectedRecordingDetails.hasAny ? (
                <div className={styles.metadataList}>
                  {selectedRecordingDetails.date ? (
                    <div className={styles.metadataRow}>
                      <span className={styles.metadataLabel}>Date</span>
                      <span className={styles.metadataValue}>{selectedRecordingDetails.date}</span>
                    </div>
                  ) : null}
                  {selectedRecordingDetails.time ? (
                    <div className={styles.metadataRow}>
                      <span className={styles.metadataLabel}>Time</span>
                      <span className={styles.metadataValue}>{selectedRecordingDetails.time}</span>
                    </div>
                  ) : null}
                  {selectedRecordingDetails.location ? (
                    <div className={styles.metadataRow}>
                      <span className={styles.metadataLabel}>Location</span>
                      <span className={styles.metadataValue}>{selectedRecordingDetails.location}</span>
                    </div>
                  ) : null}
                  {selectedRecordingDetails.notes ? (
                    <div className={styles.metadataRow}>
                      <span className={styles.metadataLabel}>Notes</span>
                      <span className={styles.metadataValue}>{selectedRecordingDetails.notes}</span>
                    </div>
                  ) : null}
                  {selectedRecordingDetails.members.length > 0 ? (
                    <div className={styles.metadataRow}>
                      <span className={styles.metadataLabel}>Members</span>
                      <ul className={styles.metadataMembersList}>
                        {selectedRecordingDetails.members.map((member, index) => (
                          <li key={`${member.name}-${member.role}-${index}`} className={styles.metadataMemberItem}>
                            <span className={styles.metadataMemberName}>{member.name || 'Unnamed member'}</span>
                            {member.role ? <span className={styles.metadataMemberRole}> • {member.role}</span> : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className={styles.sectionState}>No additional details added yet.</p>
              )}
            </section>

            <section className={styles.detailSection}>
              <div className={styles.sectionHeaderRow}>
                <span className={styles.sectionTitle}>Audio</span>
                <div className={styles.sectionActions}>
                  <button
                    type='button'
                    className={styles.collapseButton}
                    onClick={() => setIsAudioExpanded((value) => !value)}
                    aria-label={isAudioExpanded ? 'Collapse audio section' : 'Expand audio section'}
                  >
                    <ChevronDown
                      size={18}
                      className={`${styles.sectionChevron} ${!isAudioExpanded ? styles.sectionChevronCollapsed : ''}`}
                    />
                  </button>
                </div>
              </div>

              {isAudioExpanded ? (
                <div className={styles.sectionBody}>
                  {isLoadingRecordingUrl ? <p className={styles.sectionState}>Loading recording audio...</p> : null}
                  {recordingUrlError ? <p className={styles.sectionError}>{recordingUrlError}</p> : null}

                  {selectedRecordingUrl ? (
                    <audio
                      className={styles.audioPlayer}
                      src={selectedRecordingUrl}
                      controls
                      preload='metadata'
                    >
                      Your browser does not support audio playback.
                    </audio>
                  ) : null}
                </div>
              ) : null}
            </section>

            <section className={styles.detailSection}>
              <div className={styles.sectionHeaderRow}>
                <div className={styles.sectionTitleGroup}>
                  <span className={styles.sectionTitle}>Transcription</span>
                  <button
                    type='button'
                    className={styles.copyButton}
                    onClick={() => void copyTranscription()}
                    disabled={!transcription || isGeneratingTranscription}
                    aria-label={hasCopiedTranscription ? 'Transcription copied' : 'Copy transcription'}
                  >
                    {hasCopiedTranscription ? <Check size={16} /> : <Copy size={16} />}
                  </button>
                </div>
                <div className={styles.sectionActions}>
                  {canExpandTranscription && isTranscriptionSectionExpanded ? (
                    <button
                      type='button'
                      className={styles.sectionLinkButton}
                      onClick={() => setIsTranscriptionExpanded((value) => !value)}
                    >
                      {isTranscriptionExpanded ? 'Show less' : 'Show more'}
                    </button>
                  ) : null}
                  <button
                    type='button'
                    className={styles.collapseButton}
                    onClick={() => setIsTranscriptionSectionExpanded((value) => !value)}
                    aria-label={isTranscriptionSectionExpanded ? 'Collapse transcription section' : 'Expand transcription section'}
                  >
                    <ChevronDown
                      size={18}
                      className={`${styles.sectionChevron} ${
                        !isTranscriptionSectionExpanded ? styles.sectionChevronCollapsed : ''
                      }`}
                    />
                  </button>
                </div>
              </div>

              {isTranscriptionSectionExpanded ? (
                <div className={styles.sectionBody}>
                  {isGeneratingTranscription ? (
                    <p className={styles.sectionState}>Transcription is being generated in background...</p>
                  ) : null}
                  {transcriptionError ? <p className={styles.sectionError}>{transcriptionError}</p> : null}
                  {!isGeneratingTranscription && !transcriptionError && transcription ? (
                    <p
                      className={`${styles.transcriptionText} ${
                        !isTranscriptionExpanded && canExpandTranscription ? styles.transcriptionTextCollapsed : ''
                      }`}
                    >
                      {transcription}
                    </p>
                  ) : null}
                  {!isGeneratingTranscription && !transcriptionError && !transcription ? (
                    <p className={styles.sectionState}>No transcription available yet.</p>
                  ) : null}
                </div>
              ) : null}
            </section>

            <section className={styles.detailSection}>
              <div className={styles.sectionHeaderRow}>
                <h2 className={styles.sectionTitle}>Saved to-dos</h2>
                <div className={styles.sectionActions}>
                  <button
                    type='button'
                    className={styles.sectionLinkButton}
                    onClick={() => void extractAndSaveTodos()}
                    disabled={isExtractingTodos || isGeneratingTranscription}
                  >
                    {isExtractingTodos ? 'Generating...' : hasSavedTodos ? 'Regenerate list' : 'Generate to-do list'}
                  </button>
                </div>
              </div>

              {todoExtractionSummary ? <p className={styles.sectionState}>{todoExtractionSummary}</p> : null}
              {isLoadingSavedTodos ? <p className={styles.sectionState}>Loading saved to-dos...</p> : null}
              {savedTodosError ? <p className={styles.sectionError}>{savedTodosError}</p> : null}

              {!isLoadingSavedTodos && !savedTodosError && savedTodos.length === 0 ? (
                <p className={styles.sectionState}>No to-dos yet. Generate a to-do list from this transcription.</p>
              ) : null}

              {!isLoadingSavedTodos && !savedTodosError && savedTodos.length > 0 ? (
                <ul className={styles.todoList}>
                  {savedTodos.map((todo) => {
                    const isUpdatingTodo = updatingTodoKey === todo.key
                    const isTodoDone = todo.value.status === 'done'
                    const isEditingTodo = editingTodoKey === todo.key
                    const isBusy = Boolean(updatingTodoKey)

                    return (
                      <li key={todo.key} className={`${styles.todoItem} ${isTodoDone ? styles.todoItemDone : ''}`}>
                        <div className={styles.todoRow}>
                          <p className={`${styles.todoTaskText} ${isTodoDone ? styles.todoTaskTextDone : ''}`}>{todo.value.task}</p>
                          <div className={styles.todoActions}>
                            <button
                              type='button'
                              className={styles.todoStatusButton}
                              onClick={() => void toggleSavedTodoStatus(todo)}
                              disabled={isBusy || isEditingTodo}
                            >
                              {isUpdatingTodo ? 'Saving...' : isTodoDone ? 'Mark open' : 'Mark done'}
                            </button>
                            <button
                              type='button'
                              className={styles.todoIconButton}
                              onClick={() => startEditingTodo(todo)}
                              disabled={isBusy || isEditingTodo}
                              aria-label='Edit to-do'
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              type='button'
                              className={styles.todoIconButton}
                              onClick={() => void removeSavedTodo(todo)}
                              disabled={isBusy}
                              aria-label='Delete to-do'
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>

                        {isEditingTodo && todoEditDraft ? (
                          <div className={styles.todoEditForm}>
                            <label className={styles.todoEditLabel}>
                              Task
                              <input
                                type='text'
                                className={styles.todoEditInput}
                                value={todoEditDraft.task}
                                onChange={(event) =>
                                  setTodoEditDraft((current) => (current ? { ...current, task: event.target.value } : current))
                                }
                                disabled={isBusy}
                              />
                            </label>
                            <div className={styles.todoEditGrid}>
                              <label className={styles.todoEditLabel}>
                                Assignee
                                <input
                                  type='text'
                                  className={styles.todoEditInput}
                                  value={todoEditDraft.assignee}
                                  onChange={(event) =>
                                    setTodoEditDraft((current) =>
                                      current ? { ...current, assignee: event.target.value } : current,
                                    )
                                  }
                                  disabled={isBusy}
                                />
                              </label>
                              <label className={styles.todoEditLabel}>
                                Due date
                                <input
                                  type='text'
                                  className={styles.todoEditInput}
                                  placeholder='DD.MM.YYYY'
                                  value={todoEditDraft.dueDate}
                                  onChange={(event) =>
                                    setTodoEditDraft((current) =>
                                      current ? { ...current, dueDate: event.target.value } : current,
                                    )
                                  }
                                  disabled={isBusy}
                                />
                              </label>
                            </div>
                            <label className={styles.todoEditLabel}>
                              Priority
                              <select
                                className={styles.todoEditInput}
                                value={todoEditDraft.priority}
                                onChange={(event) =>
                                  setTodoEditDraft((current) =>
                                    current
                                      ? {
                                          ...current,
                                          priority: event.target.value as TodoPriorityValue,
                                        }
                                      : current,
                                  )
                                }
                                disabled={isBusy}
                              >
                                <option value=''>None</option>
                                <option value='low'>Low</option>
                                <option value='medium'>Medium</option>
                                <option value='high'>High</option>
                              </select>
                            </label>
                            <label className={styles.todoEditLabel}>
                              Notes
                              <textarea
                                className={styles.todoEditTextarea}
                                rows={3}
                                value={todoEditDraft.notes}
                                onChange={(event) =>
                                  setTodoEditDraft((current) => (current ? { ...current, notes: event.target.value } : current))
                                }
                                disabled={isBusy}
                              />
                            </label>
                            <div className={styles.todoEditActions}>
                              <button
                                type='button'
                                className={styles.todoStatusButton}
                                onClick={() => void saveEditedTodo()}
                                disabled={isBusy}
                              >
                                {isUpdatingTodo ? 'Saving...' : 'Save'}
                              </button>
                              <button
                                type='button'
                                className={styles.todoEditCancelButton}
                                onClick={cancelEditingTodo}
                                disabled={isBusy}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <p className={styles.todoMeta}>{buildSavedTodoMeta(todo)}</p>
                            {todo.value.notes ? <p className={styles.todoNotes}>{todo.value.notes}</p> : null}
                          </>
                        )}
                      </li>
                    )
                  })}
                </ul>
              ) : null}
            </section>

            <section className={styles.detailSection}>
              <h2 className={styles.sectionTitle}>Agents available</h2>

              {isLoadingAgents ? <p className={styles.sectionState}>Loading agents...</p> : null}
              {agentsError ? <p className={styles.sectionError}>{agentsError}</p> : null}
              {agentChatError ? <p className={styles.sectionError}>{agentChatError}</p> : null}

              {!isLoadingAgents && !agentsError && availableAgents.length === 0 ? (
                <p className={styles.sectionState}>No active agents available.</p>
              ) : null}

              {!isLoadingAgents && !agentsError && availableAgents.length > 0 ? (
                <ul className={styles.agentsList}>
                  {availableAgents.map((agent) => {
                    const visualStyle = placeholderByAgentId[agent.id] ?? DEFAULT_AGENT_PLACEHOLDER_META
                    const PlaceholderIcon = visualStyle.placeholderIcon
                    const hasAgentIcon = Boolean(agent.iconUrl?.trim())
                    const isOpeningThisAgent = isOpeningAgentChatId === agent.id

                    return (
                      <li key={agent.id}>
                        <button
                          type='button'
                          className={`${styles.agentCard} ${styles[visualStyle.colorClass]}`}
                          onClick={() => void openAgentChat(agent)}
                          disabled={Boolean(isOpeningAgentChatId)}
                          aria-label={`Open chat with ${agent.name}`}
                        >
                          <span className={styles.agentIconShell}>
                            {hasAgentIcon ? (
                              <img
                                className={styles.agentIconImage}
                                src={agent.iconUrl ?? undefined}
                                alt=''
                                aria-hidden='true'
                                loading='lazy'
                              />
                            ) : (
                              <PlaceholderIcon className={styles.agentIconPlaceholder} aria-hidden='true' focusable='false' />
                            )}
                          </span>
                          <span className={styles.agentCardText}>
                            <span className={styles.agentCardName}>{agent.name}</span>
                            <span className={styles.agentCardDescription}>
                              {agent.description?.trim() || `${agent.namespace}/${agent.name}`}
                            </span>
                          </span>
                          {isOpeningThisAgent ? (
                            <span className={styles.agentCardActionLabel}>Opening...</span>
                          ) : (
                            <ChevronRight size={18} />
                          )}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              ) : null}
            </section>
          </>
        ) : null}
      </main>

      {isDeleteDialogOpen && selectedRecording ? (
        <div className={styles.deleteDialogOverlay} onClick={closeDeleteDialog}>
          <div
            className={styles.deleteDialog}
            role='dialog'
            aria-modal='true'
            aria-labelledby='delete-recording-title'
            aria-describedby='delete-recording-description'
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id='delete-recording-title' className={styles.deleteDialogTitle}>
              Delete this recording?
            </h2>
            <p id='delete-recording-description' className={styles.deleteDialogDescription}>
              This will permanently remove the audio and saved details. This action cannot be undone.
            </p>
            <div className={styles.deleteDialogActions}>
              <button
                type='button'
                className={styles.deleteDialogCancelButton}
                onClick={closeDeleteDialog}
                disabled={isDeletingRecording}
              >
                Cancel
              </button>
              <button
                type='button'
                className={styles.deleteDialogConfirmButton}
                onClick={() => void confirmDeleteRecording()}
                disabled={isDeletingRecording}
              >
                <Trash2 size={14} />
                {isDeletingRecording ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isRegenerateDialogOpen ? (
        <div className={styles.deleteDialogOverlay} onClick={closeRegenerateDialog}>
          <div
            className={styles.deleteDialog}
            role='dialog'
            aria-modal='true'
            aria-labelledby='regenerate-todos-title'
            aria-describedby='regenerate-todos-description'
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id='regenerate-todos-title' className={styles.deleteDialogTitle}>
              Regenerate to-do list?
            </h2>
            <p id='regenerate-todos-description' className={styles.deleteDialogDescription}>
              This will re-run the agent and merge any new to-dos into the current list. Existing completed items will
              stay completed.
            </p>
            <div className={styles.deleteDialogActions}>
              <button
                type='button'
                className={styles.deleteDialogCancelButton}
                onClick={closeRegenerateDialog}
                disabled={isExtractingTodos}
              >
                Cancel
              </button>
              <button
                type='button'
                className={styles.deleteDialogConfirmButton}
                onClick={() => void confirmRegenerateTodos()}
                disabled={isExtractingTodos}
              >
                {isExtractingTodos ? 'Generating...' : 'Regenerate'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pendingTodoDelete ? (
        <div className={styles.deleteDialogOverlay} onClick={closeTodoDeleteDialog}>
          <div
            className={styles.deleteDialog}
            role='dialog'
            aria-modal='true'
            aria-labelledby='delete-todo-title'
            aria-describedby='delete-todo-description'
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id='delete-todo-title' className={styles.deleteDialogTitle}>
              Delete this to-do?
            </h2>
            <p id='delete-todo-description' className={styles.deleteDialogDescription}>
              This will permanently remove this to-do from the saved list. This action cannot be undone.
            </p>
            <div className={styles.deleteDialogActions}>
              <button
                type='button'
                className={styles.deleteDialogCancelButton}
                onClick={closeTodoDeleteDialog}
                disabled={isDeletingTodo}
              >
                Cancel
              </button>
              <button
                type='button'
                className={styles.deleteDialogConfirmButton}
                onClick={() => void confirmDeleteTodo()}
                disabled={isDeletingTodo}
              >
                <Trash2 size={14} />
                {isDeletingTodo ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
