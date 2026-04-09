import { runtimeApi } from './axios'
import { endpoints } from './endpoints'
import { env } from './env'

type RecordingVisibility = 'private' | 'shared'

interface UploadRecordingPayload {
  name: string
  content_base64: string
  content_type: string
  visibility: RecordingVisibility
  file_metadata: Record<string, unknown>
  update_existing: boolean
}

interface UploadRecordingResponse {
  id: string
  namespace: string
  name: string
  user_id: string
  content_type: string
  current_version: number
  file_metadata: Record<string, unknown>
  visibility: RecordingVisibility
  url?: string | null
  created_at: string
  updated_at: string
}

interface RecordingVersionResponse {
  id: string
  file_id: string
  version_number: number
  size_bytes: number
  hash_sha256: string
  uploaded_by?: string | null
  created_at: string
}

interface RecordingListItemResponse {
  id: string
  namespace: string
  name: string
  user_id: string
  content_type: string
  current_version: number
  file_metadata: Record<string, unknown>
  visibility: RecordingVisibility
  url?: string | null
  created_at: string
  updated_at: string
  versions: RecordingVersionResponse[]
}

interface RecordingUrlResponse {
  url: string
  filename: string
  content_type: string
  version: number
  expires_in: number
}

interface RecordingDownloadResponse {
  content_base64: string
  content_type: string
  file_metadata: Record<string, unknown>
  version: number
}

interface UploadRecordingOptions {
  blob: Blob
  durationMs: number
  filename?: string
  namespace?: string
  collection?: string
  visibility?: RecordingVisibility
  metadata?: Record<string, unknown>
}

interface UploadedRecording {
  id: string
  namespace: string
  collection: string
  name: string
  contentType: string
  version: number
  metadata: Record<string, unknown>
  visibility: RecordingVisibility
  url: string | null
}

export interface RecordingFile {
  id: string
  namespace: string
  collection: string
  name: string
  contentType: string
  visibility: RecordingVisibility
  currentVersion: number
  metadata: Record<string, unknown>
  url: string | null
  createdAt: string
  updatedAt: string
  versions: RecordingVersionResponse[]
}

export interface RecordingContent {
  contentBase64: string
  contentType: string
  metadata: Record<string, unknown>
  version: number
}

interface ListRecordingOptions {
  namespace?: string
  collection?: string
}

interface RecordingTarget {
  namespace: string
  collection: string
}

interface RecordingMetadataUpdatePayload {
  file_metadata: Record<string, unknown>
}

function mimeTypeToExtension(mimeType: string): string {
  if (mimeType.includes('ogg')) return 'ogg'
  if (mimeType.includes('mp4') || mimeType.includes('aac') || mimeType.includes('m4a')) return 'm4a'
  if (mimeType.includes('wav')) return 'wav'
  return 'webm'
}

function createDefaultFilename(contentType: string): string {
  const extension = mimeTypeToExtension(contentType)
  const timestamp = new Date().toISOString().replace(/[:]/g, '-')
  return `recording-${timestamp}.${extension}`
}

function getRecordingTarget(options?: { namespace?: string; collection?: string }): RecordingTarget {
  const namespace = options?.namespace || env('VITE_RECORDINGS_NAMESPACE') || 'default'
  const collection = options?.collection || env('VITE_RECORDINGS_COLLECTION') || 'recordings'

  return { namespace, collection }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error('Failed to read recorded audio'))
        return
      }

      const separatorIndex = result.indexOf(',')
      resolve(separatorIndex >= 0 ? result.slice(separatorIndex + 1) : result)
    }

    reader.onerror = () => {
      reject(new Error('Failed to encode recorded audio'))
    }

    reader.readAsDataURL(blob)
  })
}

export async function uploadRecording(options: UploadRecordingOptions): Promise<UploadedRecording> {
  const contentType = options.blob.type || 'audio/webm'
  const { namespace, collection } = getRecordingTarget(options)
  const name = options.filename || createDefaultFilename(contentType)
  const visibility = options.visibility || 'private'

  const payload: UploadRecordingPayload = {
    name,
    content_base64: await blobToBase64(options.blob),
    content_type: contentType,
    visibility,
    file_metadata: {
      duration_ms: Math.round(options.durationMs),
      recorded_at: new Date().toISOString(),
      ...(options.metadata || {}),
    },
    update_existing: false,
  }

  const response = await runtimeApi.post<UploadRecordingResponse>(
    endpoints.files.upload(namespace, collection),
    payload,
  )

  return {
    id: response.data.id,
    namespace: response.data.namespace,
    collection,
    name: response.data.name,
    contentType: response.data.content_type,
    version: response.data.current_version,
    metadata: response.data.file_metadata,
    visibility: response.data.visibility,
    url: response.data.url ?? null,
  }
}

export function getRecordingsTarget(): RecordingTarget {
  return getRecordingTarget()
}

export async function listRecordings(options?: ListRecordingOptions): Promise<RecordingFile[]> {
  const { namespace, collection } = getRecordingTarget(options)

  const response = await runtimeApi.get<RecordingListItemResponse[]>(
    endpoints.files.upload(namespace, collection),
  )

  return response.data.map((recording) => ({
    id: recording.id,
    namespace: recording.namespace,
    collection,
    name: recording.name,
    contentType: recording.content_type,
    visibility: recording.visibility,
    currentVersion: recording.current_version,
    metadata: recording.file_metadata,
    url: recording.url ?? null,
    createdAt: recording.created_at,
    updatedAt: recording.updated_at,
    versions: recording.versions,
  }))
}

export async function createRecordingTempUrl(
  recording: Pick<RecordingFile, 'namespace' | 'collection' | 'name' | 'currentVersion'>,
): Promise<string> {
  const response = await runtimeApi.post<RecordingUrlResponse>(
    `${endpoints.files.file(recording.namespace, recording.collection, recording.name)}/url`,
    null,
    {
      params: {
        version: recording.currentVersion,
        expires_in: 60 * 60,
      },
    },
  )

  return response.data.url
}

export async function downloadRecordingContent(
  recording: Pick<RecordingFile, 'namespace' | 'collection' | 'name' | 'currentVersion'>,
): Promise<RecordingContent> {
  const response = await runtimeApi.get<RecordingDownloadResponse>(
    endpoints.files.file(recording.namespace, recording.collection, recording.name),
    {
      params: {
        version: recording.currentVersion,
      },
    },
  )

  return {
    contentBase64: response.data.content_base64,
    contentType: response.data.content_type,
    metadata: response.data.file_metadata,
    version: response.data.version,
  }
}

export async function updateRecordingMetadata(
  recording: Pick<RecordingFile, 'namespace' | 'collection' | 'name'>,
  metadata: Record<string, unknown>,
): Promise<void> {
  const payload: RecordingMetadataUpdatePayload = {
    file_metadata: metadata,
  }

  await runtimeApi.patch(
    endpoints.files.file(recording.namespace, recording.collection, recording.name),
    payload,
  )
}

export async function deleteRecording(
  recording: Pick<RecordingFile, 'namespace' | 'collection' | 'name'>,
): Promise<void> {
  await runtimeApi.delete(
    endpoints.files.file(recording.namespace, recording.collection, recording.name),
  )
}
