import axios from 'axios'
import { endpoints } from './endpoints'
import { runtimeApi } from './axios'

export const PREFERENCES_PERMISSION_ERROR = 'Missing permissions to read/write preferences state'

export interface PreferenceStateRecord<TValue = unknown> {
  id?: string
  user_id?: string | null
  namespace?: string
  store_id?: string
  store_namespace?: string
  store_name?: string
  key: string
  value: TValue
  visibility: string
  description?: string | null
  tags?: string[] | null
  relevance_score?: number | null
  expires_at?: string | null
  created_at?: string
  updated_at?: string
}

export interface CreatePreferenceStateRequest<TValue = unknown> {
  key: string
  value: TValue
  visibility: string
  description?: string | null
  tags?: string[] | null
  relevance_score?: number | null
  expires_at?: string | null
}

export interface UpdatePreferenceStateRequest<TValue = unknown> {
  key?: string
  value?: TValue
  visibility?: string
  description?: string | null
  tags?: string[] | null
  relevance_score?: number | null
  expires_at?: string | null
}

export async function listPreferenceStates<TValue = unknown>(): Promise<Array<PreferenceStateRecord<TValue>>> {
  const response = await runtimeApi.get<Array<PreferenceStateRecord<TValue>>>(endpoints.preferences.states)
  return response.data
}

export async function createPreferenceState<TValue = unknown>(
  payload: CreatePreferenceStateRequest<TValue>,
): Promise<PreferenceStateRecord<TValue>> {
  const response = await runtimeApi.post<PreferenceStateRecord<TValue>>(endpoints.preferences.states, payload)
  return response.data
}

export async function updatePreferenceState<TValue = unknown>(
  key: string,
  payload: UpdatePreferenceStateRequest<TValue>,
): Promise<PreferenceStateRecord<TValue>> {
  const response = await runtimeApi.put<PreferenceStateRecord<TValue>>(endpoints.preferences.stateByKey(key), payload)
  return response.data
}

export function filterPreferenceStatesForUser<TValue>(
  states: Array<PreferenceStateRecord<TValue>> | undefined,
  userId: string | null | undefined,
): Array<PreferenceStateRecord<TValue>> {
  if (!Array.isArray(states) || !userId) return []
  return states.filter((state) => state.user_id === userId)
}

function getHttpStatus(error: unknown): number | null {
  if (!axios.isAxiosError(error)) return null
  return error.response?.status ?? null
}

export function isPreferencePermissionError(error: unknown): boolean {
  const status = getHttpStatus(error)
  return status === 401 || status === 403
}

export function isPreferenceNotFoundError(error: unknown): boolean {
  return getHttpStatus(error) === 404
}

export function isPreferenceAlreadyExistsError(error: unknown, key: string): boolean {
  if (!axios.isAxiosError(error)) return false

  const status = error.response?.status ?? null
  const message = getPreferenceErrorMessage(error, '').toLowerCase()

  return (
    status === 409 ||
    message.includes(`state with key '${key.toLowerCase()}' already exists`) ||
    message.includes(`state with key "${key.toLowerCase()}" already exists`) ||
    message.includes('already exists')
  )
}

export function getPreferenceErrorMessage(error: unknown, fallback: string): string {
  if (!axios.isAxiosError(error)) {
    if (error instanceof Error && error.message) return error.message
    return fallback
  }

  if (!error.response) return fallback

  const data = error.response.data
  if (typeof data === 'string' && data.trim()) return data

  if (data && typeof data === 'object') {
    const detail = (data as Record<string, unknown>).detail
    if (typeof detail === 'string' && detail.trim()) return detail

    const message = (data as Record<string, unknown>).message
    if (typeof message === 'string' && message.trim()) return message
  }

  return error.message || fallback
}
