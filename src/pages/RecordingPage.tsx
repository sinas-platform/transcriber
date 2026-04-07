import { Check, ChevronDown, ChevronRight, Copy } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type SVGProps } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Sidebar } from '../components/Sidebar/Sidebar'
import { useAuth } from '../features/auth/use-auth'
import {
  listAgents,
  type AgentSummary,
} from '../lib/agents'
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

function sortAgents(agents: AgentSummary[]): AgentSummary[] {
  return [...agents].sort((left, right) => {
    if (left.isDefault !== right.isDefault) {
      return left.isDefault ? -1 : 1
    }

    const leftLabel = `${left.namespace}/${left.name}`
    const rightLabel = `${right.namespace}/${right.name}`
    return leftLabel.localeCompare(rightLabel)
  })
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
  const [isLoadingAgents, setIsLoadingAgents] = useState(false)
  const [agentsError, setAgentsError] = useState<string | null>(null)

  const playbackObjectUrlRef = useRef<string | null>(null)
  const copyResetTimeoutRef = useRef<number | null>(null)

  const recordingsTarget = useMemo(() => getRecordingsTarget(), [])

  const selectedRecordingLabel = useMemo(() => {
    if (!selectedRecording) return ''
    return normalizeRecordingLabel(selectedRecording.name)
  }, [selectedRecording])

  const selectedRecordingDuration = useMemo(() => {
    if (!selectedRecording) return '--:--'
    return formatRecordingDuration(readMetadataDurationMs(selectedRecording.metadata))
  }, [selectedRecording])

  const selectedRecordingTimestamp = useMemo(() => {
    if (!selectedRecording) return ''
    const recordedAt = readMetadataRecordedAt(selectedRecording.metadata) ?? selectedRecording.updatedAt
    return formatRecordedDateTime(recordedAt)
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

      const activeAgents = sortAgents(agentsResult.value.filter((agent) => agent.isActive))
      setAvailableAgents(activeAgents)
      setIsLoadingAgents(false)
    }

    void loadDetails()

    return () => {
      isCancelled = true
    }
  }, [playbackTarget, selectedRecordingId])

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
              </div>
              <p className={styles.pageMeta}>
                {selectedRecordingDuration}
                {selectedRecordingTimestamp ? ` • ${selectedRecordingTimestamp}` : ''}
              </p>
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

              {!isLoadingAgents && !agentsError && availableAgents.length === 0 ? (
                <p className={styles.sectionState}>No active agents available.</p>
              ) : null}

              {!isLoadingAgents && !agentsError && availableAgents.length > 0 ? (
                <ul className={styles.agentsList}>
                  {availableAgents.map((agent, agentIndex) => {
                    const visualStyle = getAgentVisualStyle(agentIndex)
                    const PlaceholderIcon = visualStyle.placeholderIcon
                    const hasAgentIcon = Boolean(agent.iconUrl?.trim())

                    return (
                      <li key={agent.id}>
                        <button
                          type='button'
                          className={`${styles.agentCard} ${styles[visualStyle.colorClass]}`}
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
                          <ChevronRight size={18} />
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
