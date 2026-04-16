import { env } from './env'

const LEGACY_WORKSPACE_KEY = 'sinasWorkspaceUrl'
const WORKSPACE_CONFIG_KEY = 'sinasWorkspaceConfig'
const WORKSPACE_QUERY_PARAM = 'ws'

interface StoredWorkspaceConfig {
  url?: string
}

function normalizeWorkspaceUrl(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\/+$/, '')
}

function normalizeWorkspaceUrlFromQuery(value: string | null | undefined): string {
  const trimmed = (value ?? '').trim()
  if (!trimmed) return ''

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`

  try {
    const parsed = new URL(withProtocol)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return ''
    return withProtocol.replace(/\/+$/, '')
  } catch {
    return ''
  }
}

function compactWorkspaceUrlForQuery(normalizedWorkspaceUrl: string): string {
  try {
    const parsed = new URL(normalizedWorkspaceUrl)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return normalizedWorkspaceUrl

    const pathname = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '')
    return `${parsed.host}${pathname}${parsed.search}${parsed.hash}`
  } catch {
    return normalizedWorkspaceUrl
  }
}

const DEFAULT_WORKSPACE_URL = normalizeWorkspaceUrl(env('VITE_DEFAULT_WORKSPACE_URL'))

function readStoredWorkspaceUrl(): string {
  const rawConfig = localStorage.getItem(WORKSPACE_CONFIG_KEY)
  if (rawConfig) {
    try {
      const parsed = JSON.parse(rawConfig) as StoredWorkspaceConfig
      const normalized = normalizeWorkspaceUrl(parsed.url)
      if (normalized) return normalized
      localStorage.removeItem(WORKSPACE_CONFIG_KEY)
    } catch {
      localStorage.removeItem(WORKSPACE_CONFIG_KEY)
    }
  }

  const legacy = normalizeWorkspaceUrl(localStorage.getItem(LEGACY_WORKSPACE_KEY))
  if (legacy) {
    localStorage.setItem(WORKSPACE_CONFIG_KEY, JSON.stringify({ url: legacy }))
    localStorage.removeItem(LEGACY_WORKSPACE_KEY)
    return legacy
  }

  return ''
}

function getWorkspaceUrlFromLocationSearch(search: string): string {
  const params = new URLSearchParams(search)
  return normalizeWorkspaceUrlFromQuery(params.get(WORKSPACE_QUERY_PARAM))
}

function replaceCurrentUrlSearch(nextSearch: URLSearchParams): void {
  const nextQuery = nextSearch.toString()
  const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${window.location.hash}`
  window.history.replaceState(window.history.state, '', nextUrl)
  // Keep React Router location state aligned with direct history.replaceState calls.
  window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }))
}

export function getWorkspaceUrl(): string {
  const queryWorkspaceUrl = getWorkspaceUrlFromLocationSearch(window.location.search)
  if (queryWorkspaceUrl) return queryWorkspaceUrl
  return readStoredWorkspaceUrl() || DEFAULT_WORKSPACE_URL || ''
}

export function setWorkspaceUrl(url: string): void {
  const normalized = normalizeWorkspaceUrl(url)
  if (!normalized) {
    localStorage.removeItem(WORKSPACE_CONFIG_KEY)
    localStorage.removeItem(LEGACY_WORKSPACE_KEY)
    return
  }

  localStorage.setItem(WORKSPACE_CONFIG_KEY, JSON.stringify({ url: normalized }))
  localStorage.removeItem(LEGACY_WORKSPACE_KEY)
}

export function clearWorkspaceUrl(): void {
  localStorage.removeItem(WORKSPACE_CONFIG_KEY)
  localStorage.removeItem(LEGACY_WORKSPACE_KEY)
}

export function setWorkspaceUrlInQuery(url: string): void {
  const normalized = normalizeWorkspaceUrlFromQuery(url)
  if (!normalized) return
  const compact = compactWorkspaceUrlForQuery(normalized)

  const params = new URLSearchParams(window.location.search)
  params.set(WORKSPACE_QUERY_PARAM, compact)
  replaceCurrentUrlSearch(params)
}

export function ensureWorkspaceQueryParamFromResolvedWorkspace(): void {
  const params = new URLSearchParams(window.location.search)
  if (params.has(WORKSPACE_QUERY_PARAM)) return

  const persistedWorkspaceUrl = readStoredWorkspaceUrl()
  if (!persistedWorkspaceUrl) return

  setWorkspaceUrlInQuery(persistedWorkspaceUrl)
}

export function clearWorkspaceUrlInQuery(): void {
  const params = new URLSearchParams(window.location.search)
  params.delete(WORKSPACE_QUERY_PARAM)
  replaceCurrentUrlSearch(params)
}
