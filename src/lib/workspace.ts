import { env } from './env'

const LEGACY_WORKSPACE_KEY = 'sinasWorkspaceUrl'
const WORKSPACE_CONFIG_KEY = 'sinasWorkspaceConfig'

interface StoredWorkspaceConfig {
  url?: string
}

function normalizeWorkspaceUrl(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\/+$/, '')
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

export function getWorkspaceUrl(): string {
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
