import { Check, ChevronDown, ChevronRight, Copy, Pencil } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type SVGProps } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Sidebar } from '../components/Sidebar/Sidebar'
import { useAuth } from '../features/auth/use-auth'
import {
  listAgents,
  type AgentSummary,
} from '../lib/agents'
import {
  markAgentAsRecentlyUsed,
  readRecentAgentsByUser,
  sortAgentsByRecentUsage,
} from '../lib/agent-recency'
import { ensureAgentVisualSlots } from '../lib/agent-visual-slots'
import {
  buildRecordingBootstrapMessage,
  createChatWithAgent,
} from '../lib/chats'
import ArchPlaceholder from '../icons/agentsPlaceholders/arch.svg?react'
import BlobPlaceholder from '../icons/agentsPlaceholders/blob.svg?react'
import CirclesSquarePlaceholder from '../icons/agentsPlaceholders/circles-square.svg?react'
import CirclesVerticalPlaceholder from '../icons/agentsPlaceholders/circles-vertical.svg?react'
import CoilPlaceholder from '../icons/agentsPlaceholders/coil.svg?react'
import EllipsesPlaceholder from '../icons/agentsPlaceholders/ellipses.svg?react'
import HalfCirclesPlaceholder from '../icons/agentsPlaceholders/half-circles.svg?react'
import PetalsPlaceholder from '../icons/agentsPlaceholders/petals.svg?react'
import PinwheelPlaceholder from '../icons/agentsPlaceholders/pinwheel.svg?react'
import SemicirclesHorizontalPlaceholder from '../icons/agentsPlaceholders/semicircles-horizontal.svg?react'
import SemicirclesVerticalPlaceholder from '../icons/agentsPlaceholders/semicircles-vertical.svg?react'
import SparklePlaceholder from '../icons/agentsPlaceholders/sparkle.svg?react'
import {
  downloadRecordingContent,
  getRecordingsTarget,
  listRecordings,
  type RecordingFile,
} from '../lib/recordings'
import styles from './RecordingPage.module.scss'

type PageView = 'recording' | 'sidebar'

type AgentColorClass =
  | 'agentColorOrange'
  | 'agentColorPink'
  | 'agentColorPurple'
  | 'agentColorViolet'
  | 'agentColorIndigo'
  | 'agentColorCyan'
  | 'agentColorGreen'
  | 'agentColorYellow'

type AgentPlaceholderIcon = ComponentType<SVGProps<SVGSVGElement>>
type RecordingMember = { name: string; role: string }

const AGENT_PLACEHOLDER_ICONS = [
  ArchPlaceholder,
  BlobPlaceholder,
  CirclesSquarePlaceholder,
  CirclesVerticalPlaceholder,
  CoilPlaceholder,
  EllipsesPlaceholder,
  HalfCirclesPlaceholder,
  PetalsPlaceholder,
  PinwheelPlaceholder,
  SemicirclesHorizontalPlaceholder,
  SemicirclesVerticalPlaceholder,
  SparklePlaceholder,
] as const satisfies AgentPlaceholderIcon[]

const AGENT_COLOR_CLASSES: AgentColorClass[] = [
  'agentColorOrange',
  'agentColorPink',
  'agentColorPurple',
  'agentColorViolet',
  'agentColorIndigo',
  'agentColorCyan',
  'agentColorGreen',
  'agentColorYellow',
]

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

function readMetadataDetailsLanguage(metadata: Record<string, unknown>): string | null {
  const value = metadata.details_language
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

function getApiErrorMessage(error: unknown, fallback: string): string {
  const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail

  if (typeof detail === 'string' && detail.trim()) {
    return detail
  }

  return fallback
}

function getAgentVisualStyle(agentIndex: number): {
  placeholderIcon: AgentPlaceholderIcon
  colorClass: AgentColorClass
} {
  return {
    placeholderIcon: AGENT_PLACEHOLDER_ICONS[agentIndex % AGENT_PLACEHOLDER_ICONS.length],
    colorClass: AGENT_COLOR_CLASSES[agentIndex % AGENT_COLOR_CLASSES.length],
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

export function RecordingPage() {
  const { logout, session } = useAuth()
  const navigate = useNavigate()
  const { recordingId } = useParams<{ recordingId: string }>()

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
  const [agentVisualSlots, setAgentVisualSlots] = useState<Record<string, number>>({})
  const [isLoadingAgents, setIsLoadingAgents] = useState(false)
  const [agentsError, setAgentsError] = useState<string | null>(null)
  const [agentChatError, setAgentChatError] = useState<string | null>(null)
  const [isOpeningAgentChatId, setIsOpeningAgentChatId] = useState<string | null>(null)

  const playbackObjectUrlRef = useRef<string | null>(null)
  const copyResetTimeoutRef = useRef<number | null>(null)

  const recordingsTarget = useMemo(() => getRecordingsTarget(), [])

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
        language: null,
        members: [] as RecordingMember[],
        hasAny: false,
      }
    }

    const metadata = selectedRecording.metadata
    const date = formatDetailsDate(readMetadataDetailsDate(metadata))
    const time = readMetadataDetailsTime(metadata)
    const location = readMetadataDetailsLocation(metadata)
    const language = readMetadataDetailsLanguage(metadata)
    const members = readMetadataDetailsMembers(metadata)
    const hasAny = Boolean(date || time || location || language || members.length > 0)

    return {
      date,
      time,
      location,
      language,
      members,
      hasAny,
    }
  }, [selectedRecording])

  const canExpandTranscription = Boolean(transcription && transcription.length > 320)

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
      setRecordingsError(getApiErrorMessage(error, 'Failed to load recordings.'))
      throw error
    } finally {
      setIsLoadingRecordings(false)
    }
  }, [recordingsTarget])

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
        setRecordingError(getApiErrorMessage(error, 'Failed to load the recording.'))
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
        setRecordingUrlError(getApiErrorMessage(audioResult.reason, 'Could not load the recording audio.'))
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
      const visualSlots = ensureAgentVisualSlots(
        activeAgents.map((agent) => agent.id),
        session?.user.id,
      )
      setAgentVisualSlots(visualSlots)
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
    if (!selectedRecording) return

    const status = readMetadataTranscriptionStatus(selectedRecording.metadata)
    const text = readMetadataTranscriptionText(selectedRecording.metadata)
    const error = readMetadataTranscriptionError(selectedRecording.metadata)

    if (text || error || status === 'failed') return

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
        const latest = nextRecordings.find((recording) => recording.id === selectedRecording.id)

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
      } catch {
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
  }, [recordingsTarget, selectedRecording])

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
      void navigate(`/recordings/${selectedRecording.id}/chats/${chat.id}`, {
        state: {
          initialContent: bootstrapMessage,
        },
      })
    } catch (error) {
      setAgentChatError(getApiErrorMessage(error, 'Could not open chat with this agent.'))
    } finally {
      setIsOpeningAgentChatId(null)
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
          void navigate('/')
        }}
        onSelectRecording={(recording) => {
          setView('recording')
          void navigate(`/recordings/${recording.id}`)
        }}
        onLogout={logout}
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
            <button type='button' className={styles.sectionLinkButton} onClick={() => void navigate('/')}>
              Return to recorder
            </button>
          </section>
        ) : null}

        {!isLoadingRecording && !recordingError && selectedRecording ? (
          <>
            <section className={styles.pageHeaderSection}>
              <div className={styles.pageHeaderRow}>
                <h1 className={styles.pageTitle}>{selectedRecordingLabel}</h1>
                <button
                  type='button'
                  className={styles.editDetailsButton}
                  onClick={() => void navigate(`/recordings/${selectedRecording.id}/details/edit`)}
                  aria-label='Edit recording details'
                >
                  <Pencil size={16} />
                </button>
              </div>
              <p className={styles.pageMeta}>
                {selectedRecordingDuration}
                {selectedRecordingTimestamp ? ` • ${selectedRecordingTimestamp}` : ''}
              </p>
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
                  {selectedRecordingDetails.language ? (
                    <div className={styles.metadataRow}>
                      <span className={styles.metadataLabel}>Language</span>
                      <span className={styles.metadataValue}>{selectedRecordingDetails.language}</span>
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
                      {isTranscriptionExpanded ? 'Show less' : 'See all'}
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
                    const visualSlot = agentVisualSlots[agent.id] ?? 0
                    const visualStyle = getAgentVisualStyle(visualSlot)
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
    </div>
  )
}
