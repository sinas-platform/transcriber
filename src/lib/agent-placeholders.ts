import type { ComponentType, SVGProps } from 'react'
import ArchPlaceholder from '../icons/agentsPlaceholders/arch.svg?react'
import BlobPlaceholder from '../icons/agentsPlaceholders/blob.svg?react'
import CirclesSquarePlaceholder from '../icons/agentsPlaceholders/circles-square.svg?react'
import CirclesVerticalPlaceholder from '../icons/agentsPlaceholders/circles-vertical.svg?react'
import CoilPlaceholder from '../icons/agentsPlaceholders/coil.svg?react'
import EllipsesPlaceholder from '../icons/agentsPlaceholders/ellipses.svg?react'
import HalfCirclesPlaceholder from '../icons/agentsPlaceholders/half-circles.svg?react'
import PetalsPlaceholder from '../icons/agentsPlaceholders/petals.svg?react'
import PinwheelPlaceholder from '../icons/agentsPlaceholders/pinwheel.svg?react'
import SemicirclesHorizontalPlaceholder from '../icons/agentsPlaceholders/semicircles-horizontal.svg?react'
import SemicirclesVerticalPlaceholder from '../icons/agentsPlaceholders/semicircles-vertical.svg?react'
import SparklePlaceholder from '../icons/agentsPlaceholders/sparkle.svg?react'

type AgentColorId = 'orange' | 'pink' | 'purple' | 'violet' | 'indigo' | 'cyan' | 'green' | 'yellow'
type AgentIconId =
  | 'arch'
  | 'blob'
  | 'circles-square'
  | 'circles-vertical'
  | 'coil'
  | 'ellipses'
  | 'half-circles'
  | 'petals'
  | 'pinwheel'
  | 'semicircles-horizontal'
  | 'semicircles-vertical'
  | 'sparkle'

export type AgentColorClass =
  | 'agentColorOrange'
  | 'agentColorPink'
  | 'agentColorPurple'
  | 'agentColorViolet'
  | 'agentColorIndigo'
  | 'agentColorCyan'
  | 'agentColorGreen'
  | 'agentColorYellow'

export type AgentPlaceholderIcon = ComponentType<SVGProps<SVGSVGElement>>

export type AgentPlaceholderMeta = {
  placeholderIcon: AgentPlaceholderIcon
  colorClass: AgentColorClass
}

export type AgentPlaceholderAgent = {
  id: string
  namespace: string
  name: string
}

const AGENT_COLORS: Array<{ id: AgentColorId; className: AgentColorClass }> = [
  { id: 'orange', className: 'agentColorOrange' },
  { id: 'pink', className: 'agentColorPink' },
  { id: 'purple', className: 'agentColorPurple' },
  { id: 'violet', className: 'agentColorViolet' },
  { id: 'indigo', className: 'agentColorIndigo' },
  { id: 'cyan', className: 'agentColorCyan' },
  { id: 'green', className: 'agentColorGreen' },
  { id: 'yellow', className: 'agentColorYellow' },
]

const AGENT_ICONS: Array<{ id: AgentIconId; icon: AgentPlaceholderIcon }> = [
  { id: 'arch', icon: ArchPlaceholder },
  { id: 'blob', icon: BlobPlaceholder },
  { id: 'circles-square', icon: CirclesSquarePlaceholder },
  { id: 'circles-vertical', icon: CirclesVerticalPlaceholder },
  { id: 'coil', icon: CoilPlaceholder },
  { id: 'ellipses', icon: EllipsesPlaceholder },
  { id: 'half-circles', icon: HalfCirclesPlaceholder },
  { id: 'petals', icon: PetalsPlaceholder },
  { id: 'pinwheel', icon: PinwheelPlaceholder },
  { id: 'semicircles-horizontal', icon: SemicirclesHorizontalPlaceholder },
  { id: 'semicircles-vertical', icon: SemicirclesVerticalPlaceholder },
  { id: 'sparkle', icon: SparklePlaceholder },
]

const ICON_INDEX_BY_ID = new Map(AGENT_ICONS.map((icon, index) => [icon.id, index] as const))
const COLOR_INDEX_BY_ID = new Map(AGENT_COLORS.map((color, index) => [color.id, index] as const))

type PlaceholderOverride = {
  matches: (agent: AgentPlaceholderAgent) => boolean
  iconId: AgentIconId
  colorId: AgentColorId
}

const PLACEHOLDER_OVERRIDES: PlaceholderOverride[] = []

export const DEFAULT_AGENT_PLACEHOLDER_META: AgentPlaceholderMeta = {
  placeholderIcon: AGENT_ICONS[0].icon,
  colorClass: AGENT_COLORS[0].className,
}

function getAgentSortKey(agent: AgentPlaceholderAgent): string {
  return `${agent.namespace.toLowerCase()}::${agent.name.toLowerCase()}::${agent.id}`
}

function getAgentIdentityKey(agent: AgentPlaceholderAgent): string {
  return `${agent.namespace.toLowerCase()}::${agent.name.toLowerCase()}::${agent.id}`
}

function hashString(value: string): number {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  }
  return hash
}

function getFirstAvailableIconIndex(preferredIndex: number, used: Set<number>): number {
  if (used.size >= AGENT_ICONS.length) return preferredIndex

  let candidate = preferredIndex
  for (let offset = 0; offset < AGENT_ICONS.length; offset += 1) {
    if (!used.has(candidate)) return candidate
    candidate = (candidate + 1) % AGENT_ICONS.length
  }

  return preferredIndex
}

function findPlaceholderOverride(agent: AgentPlaceholderAgent): PlaceholderOverride | null {
  for (const override of PLACEHOLDER_OVERRIDES) {
    if (override.matches(agent)) return override
  }

  return null
}

export function buildAgentPlaceholderMetaById(
  agents: AgentPlaceholderAgent[],
): Record<string, AgentPlaceholderMeta> {
  const sortedAgents = [...agents].sort((left, right) => getAgentSortKey(left).localeCompare(getAgentSortKey(right)))
  const iconIndexByAgentId = new Map<string, number>()
  const colorIndexByAgentId = new Map<string, number>()
  const usedIconIndices = new Set<number>()
  const pendingAgents: AgentPlaceholderAgent[] = []

  sortedAgents.forEach((agent) => {
    const override = findPlaceholderOverride(agent)
    if (!override) {
      pendingAgents.push(agent)
      return
    }

    const overrideIconIndex = ICON_INDEX_BY_ID.get(override.iconId)
    const overrideColorIndex = COLOR_INDEX_BY_ID.get(override.colorId)

    if (overrideColorIndex != null) {
      colorIndexByAgentId.set(agent.id, overrideColorIndex)
    }

    if (overrideIconIndex == null) {
      pendingAgents.push(agent)
      return
    }

    if (usedIconIndices.size < AGENT_ICONS.length && usedIconIndices.has(overrideIconIndex)) {
      pendingAgents.push(agent)
      return
    }

    iconIndexByAgentId.set(agent.id, overrideIconIndex)
    usedIconIndices.add(overrideIconIndex)
  })

  pendingAgents.forEach((agent) => {
    const identityKey = getAgentIdentityKey(agent)
    const preferredIconIndex = hashString(identityKey) % AGENT_ICONS.length
    const iconIndex = getFirstAvailableIconIndex(preferredIconIndex, usedIconIndices)

    if (usedIconIndices.size < AGENT_ICONS.length) {
      usedIconIndices.add(iconIndex)
    }

    iconIndexByAgentId.set(agent.id, iconIndex)

    if (!colorIndexByAgentId.has(agent.id)) {
      const colorIndex = hashString(`${identityKey}:color`) % AGENT_COLORS.length
      colorIndexByAgentId.set(agent.id, colorIndex)
    }
  })

  const placeholderByAgentId: Record<string, AgentPlaceholderMeta> = {}
  sortedAgents.forEach((agent) => {
    const iconIndex = iconIndexByAgentId.get(agent.id) ?? 0
    const colorIndex = colorIndexByAgentId.get(agent.id) ?? 0

    const icon = AGENT_ICONS[iconIndex] ?? AGENT_ICONS[0]
    const color = AGENT_COLORS[colorIndex] ?? AGENT_COLORS[0]
    if (!icon || !color) return

    placeholderByAgentId[agent.id] = {
      placeholderIcon: icon.icon,
      colorClass: color.className,
    }
  })

  return placeholderByAgentId
}

export function buildSingleAgentPlaceholderMeta(agent: AgentPlaceholderAgent): AgentPlaceholderMeta {
  const placeholderByAgentId = buildAgentPlaceholderMetaById([agent])
  return placeholderByAgentId[agent.id] ?? DEFAULT_AGENT_PLACEHOLDER_META
}
