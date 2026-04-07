interface AgentVisualSlotsState {
  nextSlot: number
  slotsByAgentId: Record<string, number>
}

const AGENT_VISUAL_SLOTS_STORAGE_PREFIX = 'agent_visual_slots_v1'

function buildStorageKey(userId: string | null | undefined): string {
  const normalizedUserId = userId?.trim() || 'anonymous'
  return `${AGENT_VISUAL_SLOTS_STORAGE_PREFIX}:${normalizedUserId}`
}

function sanitizeState(value: unknown): AgentVisualSlotsState {
  if (!value || typeof value !== 'object') {
    return { nextSlot: 0, slotsByAgentId: {} }
  }

  const raw = value as { nextSlot?: unknown; slotsByAgentId?: unknown }

  const slotsByAgentId = Object.entries((raw.slotsByAgentId as Record<string, unknown>) || {}).reduce<
    Record<string, number>
  >((result, [agentId, slot]) => {
    if (!agentId.trim()) return result
    if (typeof slot !== 'number' || !Number.isInteger(slot) || slot < 0) return result
    result[agentId] = slot
    return result
  }, {})

  const maxExistingSlot = Object.values(slotsByAgentId).reduce((max, slot) => (slot > max ? slot : max), -1)
  const candidateNextSlot = typeof raw.nextSlot === 'number' && Number.isInteger(raw.nextSlot) && raw.nextSlot >= 0
    ? raw.nextSlot
    : maxExistingSlot + 1

  return {
    nextSlot: candidateNextSlot <= maxExistingSlot ? maxExistingSlot + 1 : candidateNextSlot,
    slotsByAgentId,
  }
}

function readState(userId: string | null | undefined): AgentVisualSlotsState {
  if (typeof window === 'undefined') {
    return { nextSlot: 0, slotsByAgentId: {} }
  }

  try {
    const raw = window.localStorage.getItem(buildStorageKey(userId))
    if (!raw) return { nextSlot: 0, slotsByAgentId: {} }
    return sanitizeState(JSON.parse(raw) as unknown)
  } catch {
    return { nextSlot: 0, slotsByAgentId: {} }
  }
}

function writeState(userId: string | null | undefined, state: AgentVisualSlotsState): void {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(buildStorageKey(userId), JSON.stringify(state))
  } catch {
    // Swallow storage errors and keep runtime fallback behavior.
  }
}

export function ensureAgentVisualSlots(
  agentIds: string[],
  userId: string | null | undefined,
): Record<string, number> {
  const normalizedAgentIds = Array.from(
    new Set(
      agentIds
        .map((agentId) => agentId.trim())
        .filter(Boolean),
    ),
  )

  const state = readState(userId)
  let hasChanges = false

  for (const agentId of normalizedAgentIds) {
    if (typeof state.slotsByAgentId[agentId] === 'number') continue
    state.slotsByAgentId[agentId] = state.nextSlot
    state.nextSlot += 1
    hasChanges = true
  }

  if (hasChanges) {
    writeState(userId, state)
  }

  return state.slotsByAgentId
}
