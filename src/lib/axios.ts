import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from 'axios'
import { env } from './env'

const ACCESS_TOKEN_KEY = 'auth_token'

function normalizeBaseUrl(baseUrl?: string): string {
  const fromEnv = env('VITE_API_BASE_URL')?.trim()
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
  const token = localStorage.getItem(ACCESS_TOKEN_KEY)
  const apiKey = env('VITE_X_API_KEY')?.trim()

  if (token) {
    setHeader(config, 'Authorization', `Bearer ${token}`)
  }

  if (apiKey) {
    setHeader(config, 'X-API-Key', apiKey)
  }

  return config
}

function attachInterceptors(client: AxiosInstance): AxiosInstance {
  client.interceptors.request.use(authInterceptor)
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
  if (token) {
    localStorage.setItem(ACCESS_TOKEN_KEY, token)
    return
  }

  localStorage.removeItem(ACCESS_TOKEN_KEY)
}
