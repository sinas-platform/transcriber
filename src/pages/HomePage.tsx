import { Check, Mic, Pause, Play, Settings, UserRound, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { RecentRecordingsList } from '../components/Home/RecentRecordingsList'
import sinasLogo from '../icons/sinas-logo-small.svg'
import {
  getRecordingsTarget,
  listRecordings,
  type RecordingFile,
  uploadRecording,
} from '../lib/recordings'
import styles from './HomePage.module.scss'

type RecordingPhase = 'idle' | 'recording' | 'paused' | 'saving'

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

export function HomePage() {
  const navigate = useNavigate()

  const [phase, setPhase] = useState<RecordingPhase>('idle')
  const [elapsedMs, setElapsedMs] = useState(0)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isLoadingRecordings, setIsLoadingRecordings] = useState(false)
  const [recordingsError, setRecordingsError] = useState<string | null>(null)
  const [recordings, setRecordings] = useState<RecordingFile[]>([])

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const elapsedBeforeCurrentSegmentRef = useRef(0)
  const segmentStartedAtRef = useRef<number | null>(null)
  const pendingStopActionRef = useRef<'cancel' | 'save' | null>(null)
  const finalDurationMsRef = useRef(0)

  const recordingsTarget = useMemo(() => getRecordingsTarget(), [])
  const isSessionActive = phase !== 'idle'
  const timerLabel = useMemo(() => formatElapsedTime(elapsedMs), [elapsedMs])

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

  const selectRecording = (recording: RecordingFile): void => {
    void navigate(`/recordings/${recording.id}`)
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
    void loadRecordings()
  }, [loadRecordings])

  useEffect(() => {
    return () => {
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

  return (
    <div className={`app-root ${styles.screen}`}>
      <header className={styles.topBar}>
        <div className={styles.brand}>
          <img className={styles.brandLogo} src={sinasLogo} alt='Sinas' />
          <span className={styles.brandText}>Transcriber</span>
        </div>

        <div className={styles.headerActions}>
          <span className={styles.avatarBadge} aria-hidden='true'>
            <UserRound size={19} strokeWidth={2.1} />
          </span>

          <button type='button' className={styles.iconAction} aria-label='Settings'>
            <Settings size={19} strokeWidth={2.1} />
          </button>
        </div>
      </header>

      <main className={styles.main}>
        <section className={styles.heroSection}>
          <div className={styles.heroCopy}>
            <h1 className={styles.title}>Start recording</h1>
            <p className={styles.subtitle}>Record anything, revisit everything.</p>
          </div>

          <section className={styles.recorderCard}>
            {isSessionActive ? (
              <>
                <div
                  className={`${styles.recordingSeal} ${phase === 'recording' ? styles.recordingSealLive : ''} ${phase === 'paused' ? styles.recordingSealPaused : ''}`}
                >
                  <div className={styles.recordingSealInner}>
                    <Mic size={32} strokeWidth={2.2} />
                  </div>
                </div>
                <p className={styles.recordingTimer}>{timerLabel}</p>

                <div className={styles.controls}>
                  <button
                    type='button'
                    className={styles.controlAction}
                    onClick={cancelRecording}
                    disabled={phase === 'saving'}
                  >
                    <span className={styles.controlCircle}>
                      <X size={20} strokeWidth={2.2} />
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
                        <Play size={20} strokeWidth={2.2} />
                      ) : (
                        <Pause size={20} strokeWidth={2.2} />
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
                      <Check size={20} strokeWidth={2.2} />
                    </span>
                    <span className={styles.controlLabel}>{phase === 'saving' ? 'Saving' : 'Save'}</span>
                  </button>
                </div>
              </>
            ) : (
              <button type='button' className={styles.startRecordingButton} onClick={() => void startRecording()}>
                <span className={styles.startIconWrap}>
                  <Mic size={38} strokeWidth={2.1} />
                </span>
                <span className={styles.startLabel}>START RECORDING</span>
              </button>
            )}
          </section>

          {errorMessage ? <p className={styles.errorText}>{errorMessage}</p> : null}
        </section>

        <div className={styles.recentShell}>
          <RecentRecordingsList
            isLoadingRecordings={isLoadingRecordings}
            recordingsError={recordingsError}
            recordings={recordings}
            onSelectRecording={selectRecording}
          />
        </div>
      </main>
    </div>
  )
}
