import { ArrowLeft, Plus, Save, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { size } from '@floating-ui/react'
import DatePicker from 'react-datepicker'
import { useNavigate, useParams } from 'react-router-dom'
import {
  getRecordingsTarget,
  listRecordings,
  updateRecordingMetadata,
  type RecordingFile,
} from '../lib/recordings'
import 'react-datepicker/dist/react-datepicker.css'
import styles from './RecordingDetailsEditPage.module.scss'

type EditableMember = {
  id: string
  name: string
  role: string
}

type FormState = {
  title: string
  date: string
  time: string
  location: string
  members: EditableMember[]
}

const METADATA_KEY = {
  title: 'title',
  date: 'details_date',
  time: 'details_time',
  location: 'details_location',
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

function toInputDate(iso: string | null): string {
  if (!iso) return ''
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return ''

  const year = parsed.getFullYear()
  const month = String(parsed.getMonth() + 1).padStart(2, '0')
  const day = String(parsed.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseInputDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null

  const year = Number.parseInt(match[1], 10)
  const month = Number.parseInt(match[2], 10) - 1
  const day = Number.parseInt(match[3], 10)
  const parsed = new Date(year, month, day)

  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month ||
    parsed.getDate() !== day
  ) {
    return null
  }

  return parsed
}

function formatAsInputDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function toInputTime(iso: string | null): string {
  if (!iso) return ''
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return ''

  const hours = String(parsed.getHours()).padStart(2, '0')
  const minutes = String(parsed.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

function parseInputTime(value: string): Date | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value)
  if (!match) return null

  const hours = Number.parseInt(match[1], 10)
  const minutes = Number.parseInt(match[2], 10)
  const parsed = new Date()
  parsed.setHours(hours, minutes, 0, 0)
  return parsed
}

function formatAsInputTime(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
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
  const recordedAt = typeof metadata.recorded_at === 'string' ? metadata.recorded_at : null

  return {
    title: readString(metadata, METADATA_KEY.title) || normalizeRecordingLabel(recording.name),
    date: readString(metadata, METADATA_KEY.date) || toInputDate(recordedAt),
    time: readString(metadata, METADATA_KEY.time) || toInputTime(recordedAt),
    location: readString(metadata, METADATA_KEY.location),
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

  const recordingsTarget = useMemo(() => getRecordingsTarget(), [])

  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [recording, setRecording] = useState<RecordingFile | null>(null)
  const [form, setForm] = useState<FormState>({
    title: '',
    date: '',
    time: '',
    location: '',
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
    } catch {
      setLoadError('Failed to load recording details.')
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

  const selectedDate = useMemo(() => parseInputDate(form.date), [form.date])
  const selectedTime = useMemo(() => parseInputTime(form.time), [form.time])
  const timePickerPopperModifiers = useMemo(
    () => [
      size({
        apply({ rects, elements }) {
          Object.assign(elements.floating.style, {
            width: `${rects.reference.width}px`,
          })
        },
      }),
    ],
    [],
  )

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
    setMetadataValue(nextMetadata, METADATA_KEY.date, form.date)
    setMetadataValue(nextMetadata, METADATA_KEY.time, form.time)
    setMetadataValue(nextMetadata, METADATA_KEY.location, form.location.trim())
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

      void navigate(`/recordings/${recording.id}`)
    } catch (error) {
      const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setSaveError(typeof detail === 'string' && detail.trim() ? detail : 'Failed to save details.')
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
            onClick={() => void navigate(`/recordings/${recordingId}`)}
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
            <button type='button' className={styles.linkButton} onClick={() => void navigate('/')}>
              Return to recorder
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

            <div className={styles.dateTimeGrid}>
              <div className={styles.fieldGroup}>
                <label htmlFor='details-date' className={styles.label}>
                  Date
                </label>
                <div className={styles.calendarField}>
                  <DatePicker
                    id='details-date'
                    selected={selectedDate}
                    onChange={(date: Date | null) =>
                      setForm((current) => ({
                        ...current,
                        date: date ? formatAsInputDate(date) : '',
                      }))
                    }
                    dateFormat='dd.MM.yyyy'
                    placeholderText='Select date'
                    className={`${styles.input} ${styles.dateInput}`}
                    wrapperClassName={styles.datePickerWrapper}
                    popperClassName={styles.datePickerPopper}
                    calendarClassName={styles.datePickerCalendar}
                    showPopperArrow={false}
                    calendarStartDay={1}
                  />
                  {selectedDate ? (
                    <button
                      type='button'
                      className={styles.dateClearButton}
                      aria-label='Clear date'
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() =>
                        setForm((current) => ({
                          ...current,
                          date: '',
                        }))
                      }
                    >
                      <X size={14} />
                    </button>
                  ) : null}
                </div>
              </div>

              <div className={styles.fieldGroup}>
                <label htmlFor='details-time' className={styles.label}>
                  Time
                </label>
                <DatePicker
                  id='details-time'
                  selected={selectedTime}
                  onChange={(date: Date | null) =>
                    setForm((current) => ({
                      ...current,
                      time: date ? formatAsInputTime(date) : '',
                    }))
                  }
                  showTimeSelect
                  showTimeSelectOnly
                  timeIntervals={5}
                  timeCaption='Time'
                  dateFormat='HH:mm'
                  placeholderText='Select time'
                  className={`${styles.input} ${styles.timeInput}`}
                  wrapperClassName={styles.timePickerWrapper}
                  popperClassName={styles.timePickerPopper}
                  calendarClassName={styles.timePickerCalendar}
                  popperModifiers={timePickerPopperModifiers}
                  showPopperArrow={false}
                />
              </div>
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
