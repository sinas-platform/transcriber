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

function normalizeBaseUrl(baseUrl?: string): string {
  const fromEnv =
    env('VITE_DEFAULT_WORKSPACE_URL')?.trim() || env('VITE_API_BASE_URL')?.trim()
  const fallback =
    window.location.hostname === 'localhost'
      ? 'http://localhost:8000'
      : `${window.location.protocol}//${window.location.host}`

  return String(baseUrl || fromEnv || fallback).replace(/\/+$/, '')
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
  const token = getAccessToken()
  const apiKey = env('VITE_X_API_KEY')?.trim()

  if (token) {
    setHeader(config, 'Authorization', `Bearer ${token}`)
  }

  if (apiKey) {
    setHeader(config, 'X-API-Key', apiKey)
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
    `${String(runtimeApi.defaults.baseURL).replace(/\/+$/, '')}${endpoints.auth.refresh}`,
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
    baseURL: `${baseURL}/api/v1`,
    headers: {
      'Content-Type': 'application/json',
    },
  }),
)

export function setApiBaseUrl(nextBaseUrl?: string): void {
  const next = normalizeBaseUrl(nextBaseUrl)
  runtimeApi.defaults.baseURL = next
  configApi.defaults.baseURL = `${next}/api/v1`
}

export function setAccessToken(token: string | null): void {
  setAccessTokenStorage(token)
}
