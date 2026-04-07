import type { AgentSummary } from './agents'

const RECENT_AGENTS_STORAGE_PREFIX = 'recent_agents_v1'
const MAX_RECENT_AGENTS = 100

type AgentLastUsedMap = Record<string, number>

function buildStorageKey(userId: string | null | undefined): string {
  const normalizedUserId = userId?.trim() || 'anonymous'
  return `${RECENT_AGENTS_STORAGE_PREFIX}:${normalizedUserId}`
}

function sanitizeLastUsedMap(value: unknown): AgentLastUsedMap {
  if (!value || typeof value !== 'object') return {}

  const entries = Object.entries(value as Record<string, unknown>)
  return entries.reduce<AgentLastUsedMap>((result, [agentId, timestamp]) => {
    if (!agentId.trim()) return result
    if (typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp > 0) {
      result[agentId] = timestamp
    }
    return result
  }, {})
}

function trimRecentAgents(lastUsedByAgentId: AgentLastUsedMap): AgentLastUsedMap {
  const entries = Object.entries(lastUsedByAgentId)

  if (entries.length <= MAX_RECENT_AGENTS) {
    return lastUsedByAgentId
  }

  return entries
    .sort((left, right) => right[1] - left[1])
    .slice(0, MAX_RECENT_AGENTS)
    .reduce<AgentLastUsedMap>((result, [agentId, timestamp]) => {
      result[agentId] = timestamp
      return result
    }, {})
}

export function readRecentAgentsByUser(userId: string | null | undefined): AgentLastUsedMap {
  if (typeof window === 'undefined') return {}

  try {
    const raw = window.localStorage.getItem(buildStorageKey(userId))
    if (!raw) return {}

    const parsed = JSON.parse(raw) as unknown
    return sanitizeLastUsedMap(parsed)
  } catch {
    return {}
  }
}

export function markAgentAsRecentlyUsed(agentId: string, userId: string | null | undefined): AgentLastUsedMap {
  if (typeof window === 'undefined') return {}

  const normalizedAgentId = agentId.trim()
  if (!normalizedAgentId) return readRecentAgentsByUser(userId)

  const current = readRecentAgentsByUser(userId)
  const next = trimRecentAgents({
    ...current,
    [normalizedAgentId]: Date.now(),
  })

  try {
    window.localStorage.setItem(buildStorageKey(userId), JSON.stringify(next))
  } catch {
    return current
  }

  return next
}

export function sortAgentsByRecentUsage(
  agents: AgentSummary[],
  recentAgentsByUser: AgentLastUsedMap,
): AgentSummary[] {
  return [...agents].sort((left, right) => {
    const leftLastUsed = recentAgentsByUser[left.id] ?? 0
    const rightLastUsed = recentAgentsByUser[right.id] ?? 0

    if (leftLastUsed !== rightLastUsed) {
      return rightLastUsed - leftLastUsed
    }

    if (left.isDefault !== right.isDefault) {
      return left.isDefault ? -1 : 1
    }

    const leftLabel = `${left.namespace}/${left.name}`
    const rightLabel = `${right.namespace}/${right.name}`
    return leftLabel.localeCompare(rightLabel)
  })
}
