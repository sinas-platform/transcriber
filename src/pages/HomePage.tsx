import { Check, ChevronRight, Menu, Mic, Pause, Play, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Sidebar } from '../components/Sidebar/Sidebar'
import { useAuth } from '../features/auth/use-auth'
import sinasLogo from '../icons/sinas-logo.svg'
import {
  listAgents,
  type AgentSummary,
} from '../lib/agents'
import {
  downloadRecordingContent,
  getRecordingsTarget,
  listRecordings,
  type RecordingFile,
  uploadRecording,
} from '../lib/recordings'
import styles from './HomePage.module.scss'

type RecordingPhase = 'idle' | 'recording' | 'paused' | 'saving'
type NonSidebarView = 'recorder' | 'recording'
type PageView = NonSidebarView | 'sidebar'

const PREFERRED_RECORDING_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  'audio/ogg',
]

function getSupportedMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  return PREFERRED_RECORDING_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type))
}

function formatElapsedTime(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':')
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

function getStartErrorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') {
      return 'Microphone permission is required to record.'
    }
    if (error.name === 'NotFoundError') {
      return 'No microphone was found on this device.'
    }
  }

  return 'Unable to start recording right now. Please try again.'
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

export function HomePage() {
  const { logout, session } = useAuth()

  const [phase, setPhase] = useState<RecordingPhase>('idle')
  const [view, setView] = useState<PageView>('recorder')
  const [viewBeforeSidebar, setViewBeforeSidebar] = useState<NonSidebarView>('recorder')
  const [elapsedMs, setElapsedMs] = useState(0)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isLoadingRecordings, setIsLoadingRecordings] = useState(false)
  const [recordingsError, setRecordingsError] = useState<string | null>(null)
  const [recordings, setRecordings] = useState<RecordingFile[]>([])

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

  const [availableAgents, setAvailableAgents] = useState<AgentSummary[]>([])
  const [isLoadingAgents, setIsLoadingAgents] = useState(false)
  const [agentsError, setAgentsError] = useState<string | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const elapsedBeforeCurrentSegmentRef = useRef(0)
  const segmentStartedAtRef = useRef<number | null>(null)
  const pendingStopActionRef = useRef<'cancel' | 'save' | null>(null)
  const finalDurationMsRef = useRef(0)
  const playbackObjectUrlRef = useRef<string | null>(null)

  const recordingsTarget = useMemo(() => getRecordingsTarget(), [])
  const isSessionActive = phase !== 'idle'
  const timerLabel = useMemo(() => formatElapsedTime(elapsedMs), [elapsedMs])

  const selectedRecordingLabel = useMemo(() => {
    if (!selectedRecording) return ''
    return normalizeRecordingLabel(selectedRecording.name)
  }, [selectedRecording])
  const selectedRecordingId = selectedRecording?.id ?? null

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

  const getElapsedMs = (): number => {
    if (segmentStartedAtRef.current === null) {
      return elapsedBeforeCurrentSegmentRef.current
    }

    return elapsedBeforeCurrentSegmentRef.current + (Date.now() - segmentStartedAtRef.current)
  }

  const resetElapsedClock = (): void => {
    elapsedBeforeCurrentSegmentRef.current = 0
    segmentStartedAtRef.current = null
    finalDurationMsRef.current = 0
    setElapsedMs(0)
  }

  const stopStreamTracks = (): void => {
    const stream = streamRef.current
    if (!stream) return

    stream.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }

  const cleanupRecorderRefs = (): void => {
    const recorder = mediaRecorderRef.current
    if (recorder) {
      recorder.ondataavailable = null
      recorder.onerror = null
      recorder.onstop = null
    }

    mediaRecorderRef.current = null
    chunksRef.current = []
    pendingStopActionRef.current = null
    stopStreamTracks()
  }

  const finishSessionAsIdle = (): void => {
    cleanupRecorderRefs()
    resetElapsedClock()
    setPhase('idle')
  }

  const revokePlaybackObjectUrl = (): void => {
    if (!playbackObjectUrlRef.current) return

    URL.revokeObjectURL(playbackObjectUrlRef.current)
    playbackObjectUrlRef.current = null
  }

  const handleRecorderStopped = async (mimeType: string): Promise<void> => {
    const stopAction = pendingStopActionRef.current
    const recordedChunks = chunksRef.current

    cleanupRecorderRefs()

    if (stopAction !== 'save') {
      resetElapsedClock()
      setPhase('idle')
      return
    }

    const blob = new Blob(recordedChunks, { type: mimeType || 'audio/webm' })
    if (!blob.size) {
      setErrorMessage('No audio was captured. Please try recording again.')
      resetElapsedClock()
      setPhase('idle')
      return
    }

    setPhase('saving')

    try {
      await uploadRecording({
        blob,
        durationMs: finalDurationMsRef.current,
      })

      setErrorMessage(null)
      setViewBeforeSidebar('recorder')
      setView('sidebar')
      await loadRecordings()
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error, 'Failed to save recording. Please try again.'))
    } finally {
      resetElapsedClock()
      setPhase('idle')
    }
  }

  const startRecording = async (): Promise<void> => {
    if (phase !== 'idle') return

    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setErrorMessage('This browser does not support audio recording.')
      return
    }

    setErrorMessage(null)
    setView('recorder')
    resetElapsedClock()

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (error) {
      setErrorMessage(getStartErrorMessage(error))
      return
    }

    try {
      const mimeType = getSupportedMimeType()
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)

      streamRef.current = stream
      mediaRecorderRef.current = recorder
      chunksRef.current = []
      pendingStopActionRef.current = null

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data)
        }
      }

      recorder.onerror = () => {
        setErrorMessage('Recording stopped unexpectedly. Please try again.')
        finishSessionAsIdle()
      }

      recorder.onstop = () => {
        void handleRecorderStopped(recorder.mimeType || mimeType || 'audio/webm')
      }

      segmentStartedAtRef.current = Date.now()
      setPhase('recording')
      recorder.start()
    } catch (error) {
      stream.getTracks().forEach((track) => track.stop())
      setErrorMessage(getStartErrorMessage(error))
      finishSessionAsIdle()
    }
  }

  const togglePause = (): void => {
    const recorder = mediaRecorderRef.current
    if (!recorder || phase === 'saving') return

    if (phase === 'recording') {
      if (segmentStartedAtRef.current !== null) {
        elapsedBeforeCurrentSegmentRef.current += Date.now() - segmentStartedAtRef.current
      }
      segmentStartedAtRef.current = null
      setElapsedMs(elapsedBeforeCurrentSegmentRef.current)

      if (recorder.state === 'recording') {
        recorder.pause()
      }

      setPhase('paused')
      return
    }

    if (phase === 'paused') {
      segmentStartedAtRef.current = Date.now()

      if (recorder.state === 'paused') {
        recorder.resume()
      }

      setPhase('recording')
    }
  }

  const cancelRecording = (): void => {
    const recorder = mediaRecorderRef.current
    pendingStopActionRef.current = 'cancel'

    if (segmentStartedAtRef.current !== null) {
      elapsedBeforeCurrentSegmentRef.current += Date.now() - segmentStartedAtRef.current
      segmentStartedAtRef.current = null
    }
    setElapsedMs(elapsedBeforeCurrentSegmentRef.current)

    if (!recorder || recorder.state === 'inactive') {
      finishSessionAsIdle()
      return
    }

    recorder.stop()
  }

  const saveRecording = (): void => {
    const recorder = mediaRecorderRef.current
    if (!recorder || phase === 'saving') return

    finalDurationMsRef.current = getElapsedMs()
    elapsedBeforeCurrentSegmentRef.current = finalDurationMsRef.current
    segmentStartedAtRef.current = null
    setElapsedMs(finalDurationMsRef.current)
    pendingStopActionRef.current = 'save'
    setPhase('saving')

    if (recorder.state === 'inactive') {
      void handleRecorderStopped(recorder.mimeType || 'audio/webm')
      return
    }

    recorder.stop()
  }

  const openSidebar = (sourceView: NonSidebarView): void => {
    if (isSessionActive) return

    setViewBeforeSidebar(sourceView)
    setView('sidebar')
    void loadRecordings()
  }

  const selectRecording = (recording: RecordingFile): void => {
    setSelectedRecording(recording)
    setPlaybackTarget({
      namespace: recording.namespace,
      collection: recording.collection,
      name: recording.name,
      currentVersion: recording.currentVersion,
    })
    setView('recording')
  }

  useEffect(() => {
    if (phase !== 'recording') return

    const interval = window.setInterval(() => {
      setElapsedMs(getElapsedMs())
    }, 250)

    return () => {
      window.clearInterval(interval)
    }
  }, [phase])

  useEffect(() => {
    return () => {
      revokePlaybackObjectUrl()
      const recorder = mediaRecorderRef.current
      if (recorder) {
        recorder.ondataavailable = null
        recorder.onerror = null
        recorder.onstop = null

        if (recorder.state !== 'inactive') {
          recorder.stop()
        }
      }
      stopStreamTracks()
    }
  }, [])

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
  }, [
    selectedRecordingId,
    playbackTarget,
  ])

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
    if (!selectedRecording || view !== 'recording') return

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

        if (latest) {
          setSelectedRecording(latest)
          const latestText = readMetadataTranscriptionText(latest.metadata)
          const latestError = readMetadataTranscriptionError(latest.metadata)
          const latestStatus = readMetadataTranscriptionStatus(latest.metadata)
          const isDone = Boolean(latestText || latestError || latestStatus === 'failed')

          if (isDone) {
            setIsGeneratingTranscription(false)
            return
          }
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
  }, [recordingsTarget, selectedRecording, view])

  if (view === 'sidebar') {
    return (
      <Sidebar
        isLoadingRecordings={isLoadingRecordings}
        recordingsError={recordingsError}
        recordings={recordings}
        userEmail={session?.user.email}
        onClose={() => setView(viewBeforeSidebar)}
        onNewRecording={() => {
          setSelectedRecording(null)
          setPlaybackTarget(null)
          setSelectedRecordingUrl(null)
          revokePlaybackObjectUrl()
          setView('recorder')
        }}
        onSelectRecording={selectRecording}
        onLogout={logout}
      />
    )
  }

  if (view === 'recording' && selectedRecording) {
    return (
      <div className={`app-root ${styles.screen}`}>
        <header className={styles.topBar}>
          <button
            type='button'
            className={styles.iconButton}
            aria-label='Open recordings menu'
            onClick={() => openSidebar('recording')}
            disabled={isSessionActive}
          >
            <Menu size={24} />
          </button>
          <div className={styles.brand}>
            <img className={styles.brandLogo} src={sinasLogo} alt='Sinas' />
          </div>
        </header>

        <main className={styles.recordingDetailsMain}>
          <section className={styles.detailSection}>
            <h1 className={styles.detailTitle}>AI generated</h1>
            <p className={styles.detailSubtitle}>{selectedRecordingLabel}</p>
            <p className={styles.detailMeta}>
              {selectedRecordingDuration}
              {selectedRecordingTimestamp ? ` • ${selectedRecordingTimestamp}` : ''}
            </p>

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
          </section>

          <section className={styles.detailSection}>
            <div className={styles.sectionHeaderRow}>
              <h2 className={styles.sectionTitle}>Transcription</h2>
              {canExpandTranscription ? (
                <button
                  type='button'
                  className={styles.sectionLinkButton}
                  onClick={() => setIsTranscriptionExpanded((value) => !value)}
                >
                  {isTranscriptionExpanded ? 'Collapse' : 'See all'}
                </button>
              ) : null}
            </div>

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
                {availableAgents.map((agent) => (
                  <li key={agent.id}>
                    <button type='button' className={styles.agentCard}>
                      <span className={styles.agentIconPlaceholder} />
                      <span className={styles.agentCardText}>
                        <span className={styles.agentCardName}>{agent.name}</span>
                        <span className={styles.agentCardDescription}>
                          {agent.description?.trim() || `${agent.namespace}/${agent.name}`}
                        </span>
                      </span>
                      <ChevronRight size={18} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        </main>
      </div>
    )
  }

  return (
    <div className={`app-root ${styles.screen}`}>
      <header className={styles.topBar}>
        <button
          type='button'
          className={styles.iconButton}
          aria-label='Open menu'
          onClick={() => openSidebar('recorder')}
          disabled={isSessionActive}
        >
          <Menu size={24} />
        </button>
        <div className={styles.brand}>
          <img className={styles.brandLogo} src={sinasLogo} alt='Sinas' />
        </div>
      </header>

      <main className={styles.main}>
        {isSessionActive ? (
          <section className={styles.recordingSession}>
            <div
              className={`${styles.recordingSeal} ${phase === 'recording' ? styles.recordingSealLive : ''} ${phase === 'paused' ? styles.recordingSealPaused : ''}`}
            >
              <div className={styles.recordingSealInner}>
                <Mic size={32} strokeWidth={2.2} />
                <span className={styles.recordingText}>{phase === 'paused' ? 'PAUSED' : 'RECORDING'}</span>
              </div>
            </div>
            <p className={styles.recordingTimer}>{timerLabel}</p>
          </section>
        ) : (
          <button type='button' className={styles.recordButton} onClick={() => void startRecording()}>
            <Mic size={32} strokeWidth={2.2} />
            <span className={styles.recordLabel}>
              <span className={styles.recordLabelLine}>START</span>
              <span className={styles.recordLabelLine}>RECORDING</span>
            </span>
          </button>
        )}
      </main>

      {isSessionActive ? (
        <footer className={styles.controls}>
          <button
            type='button'
            className={styles.controlAction}
            onClick={cancelRecording}
            disabled={phase === 'saving'}
          >
            <span className={styles.controlCircle}>
              <X size={24} strokeWidth={2.2} />
            </span>
            <span className={styles.controlLabel}>Cancel</span>
          </button>

          <button
            type='button'
            className={styles.controlAction}
            onClick={togglePause}
            disabled={phase === 'saving'}
          >
            <span className={styles.controlCircle}>
              {phase === 'paused' ? (
                <Play size={23} strokeWidth={2.2} />
              ) : (
                <Pause size={23} strokeWidth={2.2} />
              )}
            </span>
            <span className={styles.controlLabel}>{phase === 'paused' ? 'Resume' : 'Pause'}</span>
          </button>

          <button
            type='button'
            className={styles.controlAction}
            onClick={saveRecording}
            disabled={phase === 'saving'}
          >
            <span className={styles.controlCircle}>
              <Check size={23} strokeWidth={2.2} />
            </span>
            <span className={styles.controlLabel}>{phase === 'saving' ? 'Saving' : 'Save'}</span>
          </button>
        </footer>
      ) : null}

      {errorMessage ? <p className={styles.errorText}>{errorMessage}</p> : null}
    </div>
  )
}
