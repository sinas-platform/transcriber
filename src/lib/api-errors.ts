import axios from 'axios'

export type SinasConfigErrorType = 'missing_store' | 'missing_collection' | 'unknown'
export type SinasConfigErrorTarget = 'preferences' | 'recordings' | 'todos' | 'any'

export const MISSING_PREFERENCES_STORE_MESSAGE =
  'This app is not fully configured yet. Ask your administrator to configure the required preferences store in Sinas Core.'
export const MISSING_RECORDINGS_COLLECTION_MESSAGE =
  'This app is not fully configured yet. Ask your administrator to set up the recordings collection.'
export const MISSING_TODOS_STORE_MESSAGE =
  'This app is not fully configured yet. Ask your administrator to set up the transcriber to-do store.'
export const MISSING_REQUIRED_STORE_MESSAGE =
  'This app is not fully configured yet. Ask your administrator to configure the required store.'

function normalizeErrorText(value: string): string {
  return value.trim().toLowerCase()
}

function readDetailFromObject(value: Record<string, unknown>): string | null {
  const detail = value.detail
  if (typeof detail === 'string' && detail.trim()) return detail

  const message = value.message
  if (typeof message === 'string' && message.trim()) return message

  return null
}

function parseErrorPayloadString(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  try {
    const parsed = JSON.parse(trimmed)
    if (parsed && typeof parsed === 'object') {
      const detail = readDetailFromObject(parsed as Record<string, unknown>)
      if (detail) return detail
    }
  } catch {
    // Keep original value when payload is not JSON.
  }

  return trimmed
}

function matchesMissingStore(detail: string): boolean {
  const normalized = normalizeErrorText(detail)
  return (
    normalized.includes('store') &&
    (normalized.includes('not found') || normalized.includes('missing') || normalized.includes('does not exist'))
  )
}

function matchesMissingCollection(detail: string): boolean {
  const normalized = normalizeErrorText(detail)
  return (
    normalized.includes('collection') &&
    (normalized.includes('not found') || normalized.includes('missing') || normalized.includes('does not exist'))
  )
}

export function getApiErrorDetail(error: unknown): string | null {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data

    if (typeof data === 'string') {
      return parseErrorPayloadString(data)
    }

    if (data && typeof data === 'object') {
      const detail = readDetailFromObject(data as Record<string, unknown>)
      if (detail) return detail
    }

    if (typeof error.message === 'string') {
      return parseErrorPayloadString(error.message)
    }

    return null
  }

  if (error instanceof Error) {
    return parseErrorPayloadString(error.message)
  }

  if (typeof error === 'string') {
    return parseErrorPayloadString(error)
  }

  if (error && typeof error === 'object') {
    return readDetailFromObject(error as Record<string, unknown>)
  }

  return null
}

export function mapSinasConfigError(
  error: unknown,
  target: SinasConfigErrorTarget = 'any',
): SinasConfigErrorType {
  const detail = getApiErrorDetail(error)
  if (!detail) return 'unknown'

  if ((target === 'preferences' || target === 'todos' || target === 'any') && matchesMissingStore(detail)) {
    return 'missing_store'
  }

  if ((target === 'recordings' || target === 'any') && matchesMissingCollection(detail)) {
    return 'missing_collection'
  }

  return 'unknown'
}

export function getFriendlySetupError(
  error: unknown,
  target: SinasConfigErrorTarget = 'any',
): string | null {
  const errorType = mapSinasConfigError(error, target)

  if (errorType === 'missing_store') {
    if (target === 'preferences') {
      return MISSING_PREFERENCES_STORE_MESSAGE
    }

    if (target === 'todos') {
      return MISSING_TODOS_STORE_MESSAGE
    }

    return MISSING_REQUIRED_STORE_MESSAGE
  }

  if (errorType === 'missing_collection') {
    return MISSING_RECORDINGS_COLLECTION_MESSAGE
  }

  return null
}

export function getApiErrorMessage(
  error: unknown,
  fallback: string,
  options?: {
    configErrorTarget?: SinasConfigErrorTarget
    includeGenericErrorMessage?: boolean
  },
): string {
  const setupMessage = getFriendlySetupError(error, options?.configErrorTarget ?? 'any')
  if (setupMessage) {
    return setupMessage
  }

  const detail = getApiErrorDetail(error)
  if (detail) {
    return detail
  }

  if (options?.includeGenericErrorMessage && error instanceof Error && error.message.trim()) {
    return error.message
  }

  return fallback
}
