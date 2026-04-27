import { ArrowLeft, Plus, Save, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { getApiErrorMessage } from '../lib/api-errors'
import { buildRecordingSourceState, readRecordingSource } from '../lib/recording-navigation'
import {
  getRecordingsTarget,
  listRecordings,
  updateRecordingMetadata,
  type RecordingFile,
} from '../lib/recordings'
import styles from './RecordingDetailsEditPage.module.scss'

type EditableMember = {
  id: string
  name: string
  role: string
}

type FormState = {
  title: string
  location: string
  notes: string
  members: EditableMember[]
}

const METADATA_KEY = {
  title: 'title',
  location: 'details_location',
  notes: 'details_notes',
  members: 'details_members',
} as const

let nextMemberId = 1

function createMember(name = '', role = ''): EditableMember {
  const id = `member-${nextMemberId}`
  nextMemberId += 1
  return { id, name, role }
}

function normalizeRecordingLabel(name: string): string {
  return name.replace(/\.[^.]+$/, '').replace(/^recording[-_]?/i, '').replace(/[-_]/g, ' ').trim() || name
}

function readString(metadata: Record<string, unknown>, key: string): string {
  const value = metadata[key]
  if (typeof value !== 'string') return ''
  return value.trim()
}

function readMembers(metadata: Record<string, unknown>): EditableMember[] {
  const value = metadata[METADATA_KEY.members]
  if (!Array.isArray(value)) return [createMember()]

  const members = value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const name = typeof (entry as { name?: unknown }).name === 'string' ? (entry as { name: string }).name : ''
      const role = typeof (entry as { role?: unknown }).role === 'string' ? (entry as { role: string }).role : ''
      if (!name.trim() && !role.trim()) return null
      return createMember(name, role)
    })
    .filter((entry): entry is EditableMember => Boolean(entry))

  return members.length > 0 ? members : [createMember()]
}

function readInitialForm(recording: RecordingFile): FormState {
  const metadata = recording.metadata

  return {
    title: readString(metadata, METADATA_KEY.title) || normalizeRecordingLabel(recording.name),
    location: readString(metadata, METADATA_KEY.location),
    notes: readString(metadata, METADATA_KEY.notes),
    members: readMembers(metadata),
  }
}

function setMetadataValue(
  metadata: Record<string, unknown>,
  key: string,
  value: string | number | Array<{ name: string; role: string }> | null,
): void {
  if (value === null || value === '') {
    delete metadata[key]
    return
  }

  metadata[key] = value
}

export function RecordingDetailsEditPage() {
  const { recordingId } = useParams<{ recordingId: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const recordingSource = readRecordingSource(location.state)
  const backTarget = recordingSource ?? '/'
  const recordingSourceState = buildRecordingSourceState(backTarget)
  const returnLinkLabel = backTarget === '/recordings' ? 'Return to all recordings' : 'Return to recorder'

  const recordingsTarget = useMemo(() => getRecordingsTarget(), [])

  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [recording, setRecording] = useState<RecordingFile | null>(null)
  const [form, setForm] = useState<FormState>({
    title: '',
    location: '',
    notes: '',
    members: [createMember()],
  })

  const loadRecording = useCallback(async () => {
    if (!recordingId) {
      setLoadError('Recording was not found.')
      return
    }

    setIsLoading(true)
    setLoadError(null)

    try {
      const items = await listRecordings(recordingsTarget)
      const selected = items.find((item) => item.id === recordingId)

      if (!selected) {
        setLoadError('Recording was not found.')
        setRecording(null)
        return
      }

      setRecording(selected)
      setForm(readInitialForm(selected))
    } catch (error) {
      setLoadError(
        getApiErrorMessage(error, 'Failed to load recording details.', { configErrorTarget: 'recordings' }),
      )
      setRecording(null)
    } finally {
      setIsLoading(false)
    }
  }, [recordingId, recordingsTarget])

  useEffect(() => {
    void loadRecording()
  }, [loadRecording])

  const updateMember = (memberId: string, field: 'name' | 'role', value: string): void => {
    setForm((current) => ({
      ...current,
      members: current.members.map((member) =>
        member.id === memberId ? { ...member, [field]: value } : member,
      ),
    }))
  }

  const removeMember = (memberId: string): void => {
    setForm((current) => {
      const nextMembers = current.members.filter((member) => member.id !== memberId)
      return {
        ...current,
        members: nextMembers.length > 0 ? nextMembers : [createMember()],
      }
    })
  }

  const addMember = (): void => {
    setForm((current) => ({
      ...current,
      members: [...current.members, createMember()],
    }))
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!recording) return

    const members = form.members
      .map((member) => ({
        name: member.name.trim(),
        role: member.role.trim(),
      }))
      .filter((member) => member.name || member.role)

    const nextMetadata: Record<string, unknown> = { ...recording.metadata }
    setMetadataValue(nextMetadata, METADATA_KEY.title, form.title.trim())
    setMetadataValue(nextMetadata, METADATA_KEY.location, form.location.trim())
    setMetadataValue(nextMetadata, METADATA_KEY.notes, form.notes.trim())
    setMetadataValue(nextMetadata, METADATA_KEY.members, members.length ? members : null)
    delete nextMetadata.details_language

    setIsSaving(true)
    setSaveError(null)

    try {
      await updateRecordingMetadata(
        {
          namespace: recording.namespace,
          collection: recording.collection,
          name: recording.name,
        },
        nextMetadata,
      )

      void navigate(
        {
          pathname: `/recordings/${recording.id}`,
          search: location.search,
        },
        {
          state: recordingSourceState,
        },
      )
    } catch (error) {
      setSaveError(getApiErrorMessage(error, 'Failed to save details.', { configErrorTarget: 'recordings' }))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className={`app-root ${styles.screen}`}>
      <main className={styles.main}>
        <header className={styles.header}>
          <button
            type='button'
            className={styles.backButton}
            onClick={() =>
              void navigate(
                {
                  pathname: `/recordings/${recordingId}`,
                  search: location.search,
                },
                {
                  state: recordingSourceState,
                },
              )
            }
          >
            <ArrowLeft size={16} />
            Back
          </button>
          <h1 className={styles.title}>Your Recording</h1>
        </header>

        {isLoading ? (
          <section className={styles.panel}>
            <p className={styles.sectionState}>Loading recording details...</p>
          </section>
        ) : null}

        {!isLoading && loadError ? (
          <section className={styles.panel}>
            <p className={styles.sectionError}>{loadError}</p>
            <button
              type='button'
              className={styles.linkButton}
              onClick={() => void navigate({ pathname: backTarget, search: location.search })}
            >
              {returnLinkLabel}
            </button>
          </section>
        ) : null}

        {!isLoading && !loadError && recording ? (
          <form className={styles.panel} onSubmit={(event) => void handleSubmit(event)}>
            <div className={styles.fieldGroup}>
              <label htmlFor='details-title' className={styles.label}>
                Title
              </label>
              <input
                id='details-title'
                className={styles.input}
                value={form.title}
                onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                placeholder='Interview title'
              />
            </div>

            <div className={styles.fieldGroup}>
              <label htmlFor='details-location' className={styles.label}>
                Location
              </label>
              <input
                id='details-location'
                className={styles.input}
                value={form.location}
                onChange={(event) => setForm((current) => ({ ...current, location: event.target.value }))}
                placeholder='Office or remote'
              />
            </div>

            <div className={styles.fieldGroup}>
              <label htmlFor='details-notes' className={styles.label}>
                Additional notes
              </label>
              <input
                id='details-notes'
                className={styles.input}
                value={form.notes}
                onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                placeholder='Any extra context'
              />
            </div>

            <div className={styles.membersSection}>
              <div className={styles.membersHeader}>
                <span className={styles.label}>Members</span>
                <button type='button' className={styles.addMemberButton} onClick={addMember}>
                  <Plus size={14} />
                  Add member
                </button>
              </div>

              {form.members.map((member) => (
                <div key={member.id} className={styles.memberRow}>
                  <input
                    className={styles.input}
                    placeholder='Name'
                    value={member.name}
                    onChange={(event) => updateMember(member.id, 'name', event.target.value)}
                  />
                  <input
                    className={styles.input}
                    placeholder='Role'
                    value={member.role}
                    onChange={(event) => updateMember(member.id, 'role', event.target.value)}
                  />
                  <button
                    type='button'
                    className={styles.removeMemberButton}
                    onClick={() => removeMember(member.id)}
                    aria-label='Remove member'
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>

            {saveError ? <p className={styles.sectionError}>{saveError}</p> : null}

            <button type='submit' className={styles.saveButton} disabled={isSaving}>
              <Save size={16} />
              {isSaving ? 'Saving details...' : 'Save details'}
            </button>
          </form>
        ) : null}
      </main>
    </div>
  )
}
