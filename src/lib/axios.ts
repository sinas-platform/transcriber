import axios, {
  type AxiosError,
  type AxiosInstance,
  type InternalAxiosRequestConfig,
  isAxiosError,
} from 'axios'
import {
  clearStoredAuthSession,
  getAccessToken,
  readStoredAuthSession,
  replaceStoredAccessToken,
  setAccessTokenStorage,
} from './auth-session-storage'
import { env } from './env'
import { endpoints } from './endpoints'
import { getWorkspaceUrl } from './workspace'

interface RefreshResponse {
  access_token: string
  token_type: string
  expires_in: number
}

type ClientType = 'runtime' | 'config'
type WorkspaceRetriableRequestConfig = InternalAxiosRequestConfig & {
  _retry?: boolean
  _workspaceUrl?: string
}

type RefreshQueueEntry = {
  resolve: (accessToken: string) => void
  reject: (error: unknown) => void
}

type WorkspaceRefreshState = {
  isRefreshing: boolean
  queue: RefreshQueueEntry[]
}

export const AUTH_SESSION_INVALIDATED_EVENT = 'transcriber:auth-session-invalidated'

const refreshStateByWorkspace = new Map<string, WorkspaceRefreshState>()

function normalizeWorkspaceUrl(value?: string | null): string {
  return (value ?? '').trim().replace(/\/+$/, '')
}

function toConfigBaseUrl(workspaceUrl: string): string {
  return `${workspaceUrl}/api/v1`
}

function workspaceFromConfigBaseUrl(baseUrl: string): string {
  if (baseUrl.endsWith('/api/v1')) return baseUrl.slice(0, -'/api/v1'.length)
  return baseUrl
}

function isWorkspaceActive(workspaceUrl: string): boolean {
  const activeWorkspace = normalizeWorkspaceUrl(getWorkspaceUrl())
  return activeWorkspace === normalizeWorkspaceUrl(workspaceUrl)
}

function dispatchAuthSessionInvalidated(workspaceUrl: string): void {
  window.dispatchEvent(
    new CustomEvent<{ workspaceUrl: string }>(AUTH_SESSION_INVALIDATED_EVENT, {
      detail: { workspaceUrl },
    }),
  )
}

function getRefreshState(workspaceUrl: string): WorkspaceRefreshState {
  const normalized = normalizeWorkspaceUrl(workspaceUrl)
  const existing = refreshStateByWorkspace.get(normalized)
  if (existing) return existing

  const created: WorkspaceRefreshState = {
    isRefreshing: false,
    queue: [],
  }
  refreshStateByWorkspace.set(normalized, created)
  return created
}

function normalizeBaseUrl(baseUrl?: string): string | undefined {
  const normalizedBaseUrl = normalizeWorkspaceUrl(baseUrl)
  if (normalizedBaseUrl) return normalizedBaseUrl

  const workspaceUrl = normalizeWorkspaceUrl(getWorkspaceUrl())
  if (workspaceUrl) return workspaceUrl

  const fromEnv = env('VITE_DEFAULT_WORKSPACE_URL')?.trim() || env('VITE_API_BASE_URL')?.trim()
  const normalizedEnv = normalizeWorkspaceUrl(fromEnv)

  return normalizedEnv || undefined
}

function resolveRequestWorkspace(
  config: WorkspaceRetriableRequestConfig,
  clientType: ClientType,
): string {
  const pinnedWorkspace = normalizeWorkspaceUrl(config._workspaceUrl)
  if (pinnedWorkspace) return pinnedWorkspace

  const explicitBaseUrl = normalizeWorkspaceUrl(String(config.baseURL ?? ''))
  if (explicitBaseUrl) {
    return clientType === 'config' ? workspaceFromConfigBaseUrl(explicitBaseUrl) : explicitBaseUrl
  }

  const activeWorkspace = normalizeBaseUrl()
  if (!activeWorkspace) {
    throw new Error('Workspace URL is not configured. Please select a workspace first.')
  }

  return activeWorkspace
}

function setHeader(
  config: InternalAxiosRequestConfig,
  key: string,
  value: string,
): InternalAxiosRequestConfig {
  config.headers = config.headers ?? {}
  ;(config.headers as Record<string, string>)[key] = value
  return config
}

function authInterceptor(
  clientType: ClientType,
): (config: InternalAxiosRequestConfig) => InternalAxiosRequestConfig {
  return (incomingConfig: InternalAxiosRequestConfig): InternalAxiosRequestConfig => {
    const config = incomingConfig as WorkspaceRetriableRequestConfig
    const requestWorkspace = resolveRequestWorkspace(config, clientType)
    const requestBaseUrl =
      clientType === 'config' ? toConfigBaseUrl(requestWorkspace) : requestWorkspace

    config.baseURL = requestBaseUrl
    config._workspaceUrl = requestWorkspace

    const token = getAccessToken(requestWorkspace)
    const apiKey = env('VITE_X_API_KEY')?.trim()
    const applicationManifest = env('VITE_APPLICATION_MANIFEST')?.trim() || 'sinas/transcriber'

    if (token) {
      setHeader(config, 'Authorization', `Bearer ${token}`)
    }

    if (apiKey) {
      setHeader(config, 'X-API-Key', apiKey)
    }

    if (applicationManifest) {
      setHeader(config, 'X-Application', applicationManifest)
    }

    return config
  }
}

function shouldSkipRefresh(config?: InternalAxiosRequestConfig): boolean {
  const rawUrl = config?.url
  if (!rawUrl) return false

  const normalizedPath = rawUrl.replace(/^https?:\/\/[^/]+/i, '')
  return (
    normalizedPath.startsWith(endpoints.auth.login) ||
    normalizedPath.startsWith(endpoints.auth.verifyOtp) ||
    normalizedPath.startsWith(endpoints.auth.refresh)
  )
}

function processRefreshQueue(workspaceUrl: string, error: unknown, accessToken?: string): void {
  const state = getRefreshState(workspaceUrl)
  state.queue.forEach(({ resolve, reject }) => {
    if (error || !accessToken) {
      reject(error)
      return
    }

    resolve(accessToken)
  })
  state.queue = []
}

async function requestAccessTokenRefresh(workspaceUrl: string): Promise<string> {
  const session = readStoredAuthSession(workspaceUrl)
  if (!session?.refreshToken) {
    throw new Error('Missing refresh token')
  }

  const apiKey = env('VITE_X_API_KEY')?.trim()
  const refreshResponse = await axios.post<RefreshResponse>(
    `${workspaceUrl}${endpoints.auth.refresh}`,
    {
      refresh_token: session.refreshToken,
    },
    {
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'X-API-Key': apiKey } : {}),
      },
    },
  )

  const nextAccessToken = refreshResponse.data.access_token
  replaceStoredAccessToken(
    nextAccessToken,
    refreshResponse.data.token_type,
    refreshResponse.data.expires_in,
    workspaceUrl,
  )

  return nextAccessToken
}

async function responseErrorInterceptor(
  client: AxiosInstance,
  error: AxiosError,
): Promise<never | unknown> {
  const originalRequest = error.config as WorkspaceRetriableRequestConfig | undefined
  const status = error.response?.status

  if (status !== 401 || !originalRequest || originalRequest._retry || shouldSkipRefresh(originalRequest)) {
    return Promise.reject(error)
  }

  const requestWorkspace = normalizeWorkspaceUrl(originalRequest._workspaceUrl)
  if (!requestWorkspace) {
    return Promise.reject(error)
  }

  if (!isWorkspaceActive(requestWorkspace)) {
    return Promise.reject(error)
  }

  const refreshState = getRefreshState(requestWorkspace)
  if (refreshState.isRefreshing) {
    return new Promise<string>((resolve, reject) => {
      refreshState.queue.push({ resolve, reject })
    }).then((nextAccessToken) => {
      originalRequest.headers = originalRequest.headers ?? {}
      ;(originalRequest.headers as Record<string, string>).Authorization = `Bearer ${nextAccessToken}`
      originalRequest._workspaceUrl = requestWorkspace
      return client(originalRequest)
    })
  }

  originalRequest._retry = true
  refreshState.isRefreshing = true

  try {
    const nextAccessToken = await requestAccessTokenRefresh(requestWorkspace)
    processRefreshQueue(requestWorkspace, null, nextAccessToken)

    originalRequest.headers = originalRequest.headers ?? {}
    ;(originalRequest.headers as Record<string, string>).Authorization = `Bearer ${nextAccessToken}`
    originalRequest._workspaceUrl = requestWorkspace
    return client(originalRequest)
  } catch (refreshError) {
    processRefreshQueue(requestWorkspace, refreshError)
    clearStoredAuthSession(requestWorkspace)
    if (isWorkspaceActive(requestWorkspace)) {
      dispatchAuthSessionInvalidated(requestWorkspace)
    }
    return Promise.reject(isAxiosError(refreshError) ? refreshError : error)
  } finally {
    refreshState.isRefreshing = false
  }
}

function attachInterceptors(client: AxiosInstance, clientType: ClientType): AxiosInstance {
  client.interceptors.request.use(authInterceptor(clientType))
  client.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => responseErrorInterceptor(client, error),
  )
  return client
}

const baseURL = normalizeBaseUrl()

export const runtimeApi = attachInterceptors(
  axios.create({
    baseURL,
    headers: {
      'Content-Type': 'application/json',
    },
  }),
  'runtime',
)

export const configApi = attachInterceptors(
  axios.create({
    baseURL: baseURL ? `${baseURL}/api/v1` : undefined,
    headers: {
      'Content-Type': 'application/json',
    },
  }),
  'config',
)

export function setApiBaseUrl(nextBaseUrl?: string): void {
  const next = normalizeBaseUrl(nextBaseUrl)
  runtimeApi.defaults.baseURL = next
  configApi.defaults.baseURL = next ? toConfigBaseUrl(next) : undefined
}

export function setAccessToken(token: string | null): void {
  setAccessTokenStorage(token)
}
