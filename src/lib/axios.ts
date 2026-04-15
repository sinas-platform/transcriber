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

type RetriableRequestConfig = InternalAxiosRequestConfig & { _retry?: boolean }

let isRefreshing = false
let refreshQueue: Array<{
  resolve: (accessToken: string) => void
  reject: (error: unknown) => void
}> = []

function normalizeBaseUrl(baseUrl?: string): string | undefined {
  const normalizedBaseUrl = (baseUrl ?? '').trim().replace(/\/+$/, '')
  if (normalizedBaseUrl) return normalizedBaseUrl

  const workspaceUrl = getWorkspaceUrl().trim().replace(/\/+$/, '')
  if (workspaceUrl) return workspaceUrl

  const fromEnv = env('VITE_DEFAULT_WORKSPACE_URL')?.trim() || env('VITE_API_BASE_URL')?.trim()
  const normalizedEnv = (fromEnv ?? '').trim().replace(/\/+$/, '')

  return normalizedEnv || undefined
}

function requireConfiguredBaseUrl(): string {
  const configured = String(runtimeApi.defaults.baseURL ?? '').trim().replace(/\/+$/, '')
  if (!configured) {
    throw new Error('Workspace URL is not configured. Please select a workspace first.')
  }

  return configured
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

function authInterceptor(config: InternalAxiosRequestConfig): InternalAxiosRequestConfig {
  const configured = String(config.baseURL ?? runtimeApi.defaults.baseURL ?? '').trim()
  if (!configured) {
    throw new Error('Workspace URL is not configured. Please select a workspace first.')
  }

  const token = getAccessToken()
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

function processRefreshQueue(error: unknown, accessToken?: string): void {
  refreshQueue.forEach(({ resolve, reject }) => {
    if (error || !accessToken) {
      reject(error)
      return
    }

    resolve(accessToken)
  })
  refreshQueue = []
}

async function requestAccessTokenRefresh(): Promise<string> {
  const session = readStoredAuthSession()
  if (!session?.refreshToken) {
    throw new Error('Missing refresh token')
  }

  const apiKey = env('VITE_X_API_KEY')?.trim()
  const refreshResponse = await axios.post<RefreshResponse>(
    `${requireConfiguredBaseUrl()}${endpoints.auth.refresh}`,
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
  )

  return nextAccessToken
}

async function responseErrorInterceptor(
  client: AxiosInstance,
  error: AxiosError,
): Promise<never | unknown> {
  const originalRequest = error.config as RetriableRequestConfig | undefined
  const status = error.response?.status

  if (status !== 401 || !originalRequest || originalRequest._retry || shouldSkipRefresh(originalRequest)) {
    return Promise.reject(error)
  }

  if (isRefreshing) {
    return new Promise<string>((resolve, reject) => {
      refreshQueue.push({ resolve, reject })
    }).then((nextAccessToken) => {
      originalRequest.headers = originalRequest.headers ?? {}
      ;(originalRequest.headers as Record<string, string>).Authorization = `Bearer ${nextAccessToken}`
      return client(originalRequest)
    })
  }

  originalRequest._retry = true
  isRefreshing = true

  try {
    const nextAccessToken = await requestAccessTokenRefresh()
    processRefreshQueue(null, nextAccessToken)

    originalRequest.headers = originalRequest.headers ?? {}
    ;(originalRequest.headers as Record<string, string>).Authorization = `Bearer ${nextAccessToken}`
    return client(originalRequest)
  } catch (refreshError) {
    processRefreshQueue(refreshError)
    clearStoredAuthSession()
    return Promise.reject(isAxiosError(refreshError) ? refreshError : error)
  } finally {
    isRefreshing = false
  }
}

function attachInterceptors(client: AxiosInstance): AxiosInstance {
  client.interceptors.request.use(authInterceptor)
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
)

export const configApi = attachInterceptors(
  axios.create({
    baseURL: baseURL ? `${baseURL}/api/v1` : undefined,
    headers: {
      'Content-Type': 'application/json',
    },
  }),
)

export function setApiBaseUrl(nextBaseUrl?: string): void {
  const next = normalizeBaseUrl(nextBaseUrl)
  runtimeApi.defaults.baseURL = next
  configApi.defaults.baseURL = next ? `${next}/api/v1` : undefined
}

export function setAccessToken(token: string | null): void {
  setAccessTokenStorage(token)
}
