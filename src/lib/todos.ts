import axios from 'axios'
import { invokeAgentWithMessage } from './agents'
import { runtimeApi } from './axios'
import { getApiErrorDetail, getFriendlySetupError } from './api-errors'
import { endpoints } from './endpoints'
import { env } from './env'

type TodoPriority = 'low' | 'medium' | 'high'
export type TodoStatus = 'open' | 'done'

interface StoreStateResponse<TValue = unknown> {
  key: string
  value: TValue
  visibility: string
  description?: string | null
  tags?: string[] | null
  relevance_score?: number | null
  expires_at?: string | null
  created_at: string
  updated_at: string
}

interface TodoStoreTarget {
  namespace: string
  name: string
}

interface ExtractedTodoItem {
  task: string
  assignee: string | null
  due_date: string | null
  priority: TodoPriority | null
  notes: string | null
}

type TodoSourceAgent = {
  namespace: string
  name: string
} | null

interface RecordingTodoItemValue {
  id: string
  task: string
  normalized_task: string
  assignee: string | null
  due_date: string | null
  priority: TodoPriority | null
  notes: string | null
  status: TodoStatus
  source_agent: TodoSourceAgent
  extracted_at: string
  completed_at: string | null
  updated_at: string
}

interface RecordingTodosStateValue {
  version: 1
  recording_id: string
  recording_title: string | null
  todos: RecordingTodoItemValue[]
}

export interface SavedTodo {
  key: string
  value: TodoStateValue
  visibility: string
  description: string | null
  tags: string[]
  relevanceScore: number | null
  expiresAt: string | null
  createdAt: string
  updatedAt: string
}

export interface TodoStateValue {
  version: 1
  recording_id: string
  recording_title: string | null
  task: string
  normalized_task: string
  assignee: string | null
  due_date: string | null
  priority: TodoPriority | null
  notes: string | null
  status: TodoStatus
  source_agent: TodoSourceAgent
  extracted_at: string
  completed_at: string | null
}

export interface SavedTodoUpdate {
  task: string
  assignee: string | null
  due_date: string | null
  priority: TodoPriority | null
  notes: string | null
}

export interface ExtractAndPersistTodosParams {
  recordingId: string
  recordingTitle: string
  transcription: string
  agentNamespace: string
  agentName: string
}

export interface ExtractAndPersistTodosResult {
  rawReply: string
  parsedCount: number
  invalidCount: number
  createdCount: number
  duplicateCount: number
  savedTodos: SavedTodo[]
}

const TODO_STATE_VISIBILITY = 'private'
const TODO_STATE_RELEVANCE_SCORE = 1
const TODO_STATE_VERSION = 1

function getTodoStoreTarget(): TodoStoreTarget {
  const namespace = env('VITE_TODOS_STORE_NAMESPACE')?.trim() || 'default'
  const name = env('VITE_TODOS_STORE_NAME')?.trim() || 'transcriber_todos'

  return {
    namespace,
    name,
  }
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

function normalizeNullableString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized || null
}

function normalizePriority(value: unknown): TodoPriority | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  if (normalized === 'low' || normalized === 'medium' || normalized === 'high') {
    return normalized
  }
  return null
}

function normalizeIsoDateParts(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null

  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null
  }

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function normalizeDueDate(value: unknown): string | null {
  const normalized = normalizeNullableString(value)
  if (!normalized) return null

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized)
  if (isoMatch) {
    const year = Number.parseInt(isoMatch[1], 10)
    const month = Number.parseInt(isoMatch[2], 10)
    const day = Number.parseInt(isoMatch[3], 10)
    return normalizeIsoDateParts(year, month, day) || normalized
  }

  const europeanMatch = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(normalized)
  if (europeanMatch) {
    const day = Number.parseInt(europeanMatch[1], 10)
    const month = Number.parseInt(europeanMatch[2], 10)
    const year = Number.parseInt(europeanMatch[3], 10)
    return normalizeIsoDateParts(year, month, day) || normalized
  }

  return normalized
}

function normalizeSourceAgent(value: unknown): TodoSourceAgent {
  if (!value || typeof value !== 'object') return null

  const record = value as Record<string, unknown>
  const namespace = normalizeNullableString(record.namespace) || 'default'
  const name = normalizeNullableString(record.name) || 'unknown'

  return {
    namespace,
    name,
  }
}

function hashString(value: string): string {
  let hash = 2166136261

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return (hash >>> 0).toString(16).padStart(8, '0')
}

function buildTodoDedupeKey(task: string, assignee: string | null, dueDate: string | null): string {
  return [normalizeText(task), normalizeText(assignee ?? ''), normalizeText(dueDate ?? '')].join('::')
}

function buildTodoId(recordingId: string, task: string, assignee: string | null, dueDate: string | null): string {
  const fingerprint = [normalizeText(recordingId), buildTodoDedupeKey(task, assignee, dueDate)].join('::')
  return `todo_${hashString(fingerprint)}`
}

function buildRecordingTodosStateKey(recordingId: string): string {
  return `recording_todos_${recordingId.trim()}`
}

function buildTodoTags(recordingId: string): string[] {
  return ['transcriber', 'todo', `recording:${recordingId}`]
}

function extractTaskText(entry: Record<string, unknown>): string | null {
  const candidates = [entry.task, entry.title, entry.text, entry.action, entry.item]

  for (const value of candidates) {
    const normalized = normalizeNullableString(value)
    if (normalized) return normalized
  }

  return null
}

function extractTodoItemsFromPayload(payload: unknown): { items: ExtractedTodoItem[]; invalidCount: number } {
  const sourceItems = (() => {
    if (Array.isArray(payload)) return payload

    if (payload && typeof payload === 'object') {
      const record = payload as Record<string, unknown>
      const candidates = [record.items, record.todos, record.tasks, record.action_items, record.actionItems]

      for (const candidate of candidates) {
        if (Array.isArray(candidate)) return candidate
      }
    }

    return []
  })()

  let invalidCount = 0
  const items: ExtractedTodoItem[] = []

  sourceItems.forEach((rawItem) => {
    if (typeof rawItem === 'string') {
      const task = normalizeNullableString(rawItem)
      if (!task) {
        invalidCount += 1
        return
      }

      items.push({
        task,
        assignee: null,
        due_date: null,
        priority: null,
        notes: null,
      })
      return
    }

    if (!rawItem || typeof rawItem !== 'object') {
      invalidCount += 1
      return
    }

    const entry = rawItem as Record<string, unknown>
    const task = extractTaskText(entry)
    if (!task) {
      invalidCount += 1
      return
    }

    items.push({
      task,
      assignee: normalizeNullableString(entry.assignee ?? entry.owner ?? entry.assigned_to ?? entry.person),
      due_date: normalizeDueDate(entry.due_date ?? entry.dueDate ?? entry.deadline),
      priority: normalizePriority(entry.priority),
      notes: normalizeNullableString(entry.notes ?? entry.context),
    })
  })

  return { items, invalidCount }
}

function tryParseAgentJsonPayload(reply: string): { parsed: boolean; payload: unknown | null } {
  const trimmed = reply.trim()
  if (!trimmed) return { parsed: false, payload: null }

  try {
    return { parsed: true, payload: JSON.parse(trimmed) as unknown }
  } catch {
    // Fall back to block extraction.
  }

  const codeBlockPattern = /```(?:json)?\s*([\s\S]*?)```/gi
  let codeBlockMatch = codeBlockPattern.exec(reply)
  while (codeBlockMatch) {
    const blockContent = codeBlockMatch[1]?.trim()
    if (blockContent) {
      try {
        return { parsed: true, payload: JSON.parse(blockContent) as unknown }
      } catch {
        // Continue to next block.
      }
    }
    codeBlockMatch = codeBlockPattern.exec(reply)
  }

  const firstObjectIndex = reply.indexOf('{')
  const lastObjectIndex = reply.lastIndexOf('}')
  if (firstObjectIndex >= 0 && lastObjectIndex > firstObjectIndex) {
    const candidate = reply.slice(firstObjectIndex, lastObjectIndex + 1)
    try {
      return { parsed: true, payload: JSON.parse(candidate) as unknown }
    } catch {
      // Fall back below.
    }
  }

  const firstArrayIndex = reply.indexOf('[')
  const lastArrayIndex = reply.lastIndexOf(']')
  if (firstArrayIndex >= 0 && lastArrayIndex > firstArrayIndex) {
    const candidate = reply.slice(firstArrayIndex, lastArrayIndex + 1)
    try {
      return { parsed: true, payload: JSON.parse(candidate) as unknown }
    } catch {
      // No-op.
    }
  }

  return { parsed: false, payload: null }
}

function parseTodoItemsFromBulletList(reply: string): ExtractedTodoItem[] {
  const items: ExtractedTodoItem[] = []
  const pattern = /^\s*(?:[-*]|\d+[.)])\s+(?:\[[ xX]\]\s*)?(.+?)\s*$/gm
  let match = pattern.exec(reply)

  while (match) {
    const task = normalizeNullableString(match[1])
    if (task) {
      items.push({
        task,
        assignee: null,
        due_date: null,
        priority: null,
        notes: null,
      })
    }
    match = pattern.exec(reply)
  }

  return items
}

function parseExtractedTodoItems(reply: string): { items: ExtractedTodoItem[]; invalidCount: number } {
  const jsonAttempt = tryParseAgentJsonPayload(reply)
  if (jsonAttempt.parsed) {
    return extractTodoItemsFromPayload(jsonAttempt.payload)
  }

  return {
    items: parseTodoItemsFromBulletList(reply),
    invalidCount: 0,
  }
}

function normalizeTodoStateValue(value: unknown): TodoStateValue | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>

  const recordingId = normalizeNullableString(record.recording_id ?? record.recordingId)
  const task = normalizeNullableString(record.task ?? record.title ?? record.text)
  if (!recordingId || !task) return null

  const statusValue = normalizeNullableString(record.status)
  const status: TodoStatus = statusValue === 'done' ? 'done' : 'open'

  return {
    version: TODO_STATE_VERSION,
    recording_id: recordingId,
    recording_title: normalizeNullableString(record.recording_title ?? record.recordingTitle),
    task,
    normalized_task: normalizeNullableString(record.normalized_task) || normalizeText(task),
    assignee: normalizeNullableString(record.assignee),
    due_date: normalizeDueDate(record.due_date ?? record.dueDate),
    priority: normalizePriority(record.priority),
    notes: normalizeNullableString(record.notes),
    status,
    source_agent: normalizeSourceAgent(record.source_agent),
    extracted_at: normalizeNullableString(record.extracted_at) || '',
    completed_at: normalizeNullableString(record.completed_at),
  }
}

function normalizeRecordingTodoItemValue(
  value: unknown,
  recordingId: string,
  fallbackUpdatedAt: string,
): RecordingTodoItemValue | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>

  const task = normalizeNullableString(record.task ?? record.title ?? record.text)
  if (!task) return null

  const assignee = normalizeNullableString(record.assignee)
  const dueDate = normalizeDueDate(record.due_date ?? record.dueDate)
  const extractedAt = normalizeNullableString(record.extracted_at) || ''
  const completedAt = normalizeNullableString(record.completed_at)
  const normalizedTask = normalizeNullableString(record.normalized_task) || normalizeText(task)
  const id = normalizeNullableString(record.id ?? record.todo_id) || buildTodoId(recordingId, task, assignee, dueDate)

  const statusValue = normalizeNullableString(record.status)
  const status: TodoStatus = statusValue === 'done' ? 'done' : 'open'

  return {
    id,
    task,
    normalized_task: normalizedTask,
    assignee,
    due_date: dueDate,
    priority: normalizePriority(record.priority),
    notes: normalizeNullableString(record.notes),
    status,
    source_agent: normalizeSourceAgent(record.source_agent),
    extracted_at: extractedAt,
    completed_at: completedAt,
    updated_at: normalizeNullableString(record.updated_at) || completedAt || extractedAt || fallbackUpdatedAt,
  }
}

function normalizeRecordingTodosStateValue(
  value: unknown,
  fallbackUpdatedAt: string,
): RecordingTodosStateValue | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>

  const recordingId = normalizeNullableString(record.recording_id ?? record.recordingId)
  if (!recordingId) return null

  const sourceTodos = Array.isArray(record.todos) ? record.todos : []
  const todos = sourceTodos
    .map((item) => normalizeRecordingTodoItemValue(item, recordingId, fallbackUpdatedAt))
    .filter((item): item is RecordingTodoItemValue => Boolean(item))

  return {
    version: TODO_STATE_VERSION,
    recording_id: recordingId,
    recording_title: normalizeNullableString(record.recording_title ?? record.recordingTitle),
    todos,
  }
}

function buildRecordingTodoItemValueFromLegacy(
  todo: TodoStateValue,
  fallbackUpdatedAt: string,
): RecordingTodoItemValue {
  const id = buildTodoId(todo.recording_id, todo.task, todo.assignee, todo.due_date)

  return {
    id,
    task: todo.task,
    normalized_task: todo.normalized_task,
    assignee: todo.assignee,
    due_date: todo.due_date,
    priority: todo.priority,
    notes: todo.notes,
    status: todo.status,
    source_agent: todo.source_agent,
    extracted_at: todo.extracted_at,
    completed_at: todo.completed_at,
    updated_at: todo.completed_at || todo.extracted_at || fallbackUpdatedAt,
  }
}

function buildRecordingTodoStateValue(
  recordingId: string,
  recordingTitle: string | null,
  todos: RecordingTodoItemValue[],
): RecordingTodosStateValue {
  return {
    version: TODO_STATE_VERSION,
    recording_id: recordingId,
    recording_title: recordingTitle,
    todos,
  }
}

function dedupeRecordingTodoItems(items: RecordingTodoItemValue[]): RecordingTodoItemValue[] {
  const seen = new Set<string>()
  const deduped: RecordingTodoItemValue[] = []

  for (const item of items) {
    const key = buildTodoDedupeKey(item.task, item.assignee, item.due_date)
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(item)
  }

  return deduped
}

function mapStateToSavedTodo(state: StoreStateResponse<unknown>): SavedTodo | null {
  const value = normalizeTodoStateValue(state.value)
  if (!value) return null

  return {
    key: state.key,
    value,
    visibility: state.visibility,
    description: state.description ?? null,
    tags: Array.isArray(state.tags) ? state.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    relevanceScore: state.relevance_score ?? null,
    expiresAt: state.expires_at ?? null,
    createdAt: state.created_at,
    updatedAt: state.updated_at,
  }
}

function mapRecordingStateToSavedTodos(state: StoreStateResponse<unknown>): SavedTodo[] {
  const recordingValue = normalizeRecordingTodosStateValue(state.value, state.updated_at)
  if (!recordingValue) return []

  const tags = Array.isArray(state.tags) ? state.tags.filter((tag): tag is string => typeof tag === 'string') : []

  return dedupeRecordingTodoItems(recordingValue.todos).map((todo) => ({
    key: todo.id,
    value: {
      version: TODO_STATE_VERSION,
      recording_id: recordingValue.recording_id,
      recording_title: recordingValue.recording_title,
      task: todo.task,
      normalized_task: todo.normalized_task,
      assignee: todo.assignee,
      due_date: todo.due_date,
      priority: todo.priority,
      notes: todo.notes,
      status: todo.status,
      source_agent: todo.source_agent,
      extracted_at: todo.extracted_at,
      completed_at: todo.completed_at,
    },
    visibility: state.visibility,
    description: state.description ?? null,
    tags,
    relevanceScore: state.relevance_score ?? null,
    expiresAt: state.expires_at ?? null,
    createdAt: todo.extracted_at || state.created_at,
    updatedAt: todo.updated_at || state.updated_at,
  }))
}

function sortSavedTodos(todos: SavedTodo[]): SavedTodo[] {
  return [...todos].sort((left, right) => {
    if (left.value.status !== right.value.status) {
      return left.value.status === 'open' ? -1 : 1
    }

    const leftTime = new Date(left.updatedAt).getTime()
    const rightTime = new Date(right.updatedAt).getTime()
    return rightTime - leftTime
  })
}

function buildTodoExtractionPrompt(recordingTitle: string, transcription: string): string {
  const safeTitle = recordingTitle.trim() || 'Recording'
  const safeTranscription = transcription.trim()

  return [
    'Extract action items from the meeting transcription below.',
    'Return ONLY valid JSON using this exact schema:',
    '{"items":[{"task":"string","assignee":"string|null","due_date":"string|null","priority":"low|medium|high|null","notes":"string|null"}]}',
    'Rules:',
    '- Include only concrete action items someone should do.',
    '- task must be concise and specific.',
    '- If a field is unknown, use null.',
    '- Do not include any explanation outside JSON.',
    `Recording title: ${safeTitle}`,
    '',
    'Transcription:',
    safeTranscription,
  ].join('\n')
}

function isStateAlreadyExistsError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false

  const status = error.response?.status ?? null
  if (status === 409) return true

  const detail = getApiErrorDetail(error)?.toLowerCase() ?? ''
  return status === 400 && detail.includes('already exists')
}

async function listTodoStates(): Promise<StoreStateResponse<unknown>[]> {
  const target = getTodoStoreTarget()

  const response = await runtimeApi.get<StoreStateResponse<unknown>[]>(
    endpoints.stores.states(target.namespace, target.name),
    {
      params: {
        limit: 1000,
      },
    },
  )

  return response.data
}

function findRecordingTodosState(
  states: StoreStateResponse<unknown>[],
  recordingId: string,
): StoreStateResponse<unknown> | null {
  const stateKey = buildRecordingTodosStateKey(recordingId)
  return states.find((state) => state.key === stateKey) ?? null
}

function listLegacySavedTodosForRecording(states: StoreStateResponse<unknown>[], recordingId: string): SavedTodo[] {
  return states
    .map(mapStateToSavedTodo)
    .filter((todo): todo is SavedTodo => Boolean(todo && todo.value.recording_id === recordingId))
}

function listLegacyRecordingTodoItems(
  states: StoreStateResponse<unknown>[],
  recordingId: string,
): RecordingTodoItemValue[] {
  const legacyTodos = listLegacySavedTodosForRecording(states, recordingId)

  return dedupeRecordingTodoItems(
    legacyTodos.map((todo) => buildRecordingTodoItemValueFromLegacy(todo.value, todo.updatedAt || todo.createdAt)),
  )
}

function resolveRecordingTodosForMutation(
  states: StoreStateResponse<unknown>[],
  recordingId: string,
): { existingRecordingState: StoreStateResponse<unknown> | null; todos: RecordingTodoItemValue[] } {
  const existingRecordingState = findRecordingTodosState(states, recordingId)

  if (!existingRecordingState) {
    return {
      existingRecordingState,
      todos: listLegacyRecordingTodoItems(states, recordingId),
    }
  }

  const normalized = normalizeRecordingTodosStateValue(existingRecordingState.value, existingRecordingState.updated_at)
  if (!normalized || normalized.recording_id !== recordingId) {
    return {
      existingRecordingState,
      todos: [],
    }
  }

  return {
    existingRecordingState,
    todos: dedupeRecordingTodoItems(normalized.todos),
  }
}

function findTodoIndexBySavedTodo(todos: RecordingTodoItemValue[], todo: SavedTodo): number {
  const todoDedupeKey = buildTodoDedupeKey(todo.value.task, todo.value.assignee, todo.value.due_date)

  return todos.findIndex(
    (entry) => entry.id === todo.key || buildTodoDedupeKey(entry.task, entry.assignee, entry.due_date) === todoDedupeKey,
  )
}

async function upsertRecordingTodosState(
  recordingId: string,
  recordingTitle: string,
  todos: RecordingTodoItemValue[],
  existingState: StoreStateResponse<unknown> | null,
): Promise<StoreStateResponse<unknown>> {
  const { namespace, name } = getTodoStoreTarget()
  const stateKey = buildRecordingTodosStateKey(recordingId)
  const nextValue = buildRecordingTodoStateValue(recordingId, recordingTitle || null, dedupeRecordingTodoItems(todos))

  if (existingState) {
    const response = await runtimeApi.put<StoreStateResponse<unknown>>(
      endpoints.stores.stateByKey(namespace, name, stateKey),
      {
        value: nextValue,
      },
    )

    return response.data
  }

  try {
    const response = await runtimeApi.post<StoreStateResponse<unknown>>(endpoints.stores.states(namespace, name), {
      key: stateKey,
      value: nextValue,
      visibility: TODO_STATE_VISIBILITY,
      description: `To-dos extracted from recording "${recordingTitle || 'Recording'}"`,
      tags: buildTodoTags(recordingId),
      relevance_score: TODO_STATE_RELEVANCE_SCORE,
      expires_at: null,
    })

    return response.data
  } catch (error) {
    if (!isStateAlreadyExistsError(error)) {
      throw error
    }

    const response = await runtimeApi.put<StoreStateResponse<unknown>>(
      endpoints.stores.stateByKey(namespace, name, stateKey),
      {
        value: nextValue,
      },
    )

    return response.data
  }
}

export async function listSavedTodosForRecording(recordingId: string): Promise<SavedTodo[]> {
  const normalizedRecordingId = recordingId.trim()
  if (!normalizedRecordingId) return []

  const states = await listTodoStates()
  const recordingState = findRecordingTodosState(states, normalizedRecordingId)

  if (recordingState) {
    return sortSavedTodos(mapRecordingStateToSavedTodos(recordingState))
  }

  return sortSavedTodos(listLegacySavedTodosForRecording(states, normalizedRecordingId))
}

export async function extractAndPersistTodosForRecording(
  params: ExtractAndPersistTodosParams,
): Promise<ExtractAndPersistTodosResult> {
  const recordingId = params.recordingId.trim()
  const recordingTitle = params.recordingTitle.trim() || 'Recording'
  const transcription = params.transcription.trim()

  if (!recordingId) {
    throw new Error('Recording ID is required to persist to-dos.')
  }

  if (!transcription) {
    throw new Error('Transcription is required to extract to-dos.')
  }

  const invokeResult = await invokeAgentWithMessage(
    params.agentNamespace,
    params.agentName,
    buildTodoExtractionPrompt(recordingTitle, transcription),
  )

  const parsed = parseExtractedTodoItems(invokeResult.reply)
  const existingStates = await listTodoStates()
  const { existingRecordingState, todos: baseTodos } = resolveRecordingTodosForMutation(existingStates, recordingId)

  const mergedTodos = [...baseTodos]
  const knownDedupeKeys = new Set(mergedTodos.map((todo) => buildTodoDedupeKey(todo.task, todo.assignee, todo.due_date)))

  let createdCount = 0
  let duplicateCount = 0

  for (const item of parsed.items) {
    const task = item.task.trim()
    if (!task) continue

    const assignee = normalizeNullableString(item.assignee)
    const dueDate = normalizeDueDate(item.due_date)
    const dedupeKey = buildTodoDedupeKey(task, assignee, dueDate)

    if (knownDedupeKeys.has(dedupeKey)) {
      duplicateCount += 1
      continue
    }

    knownDedupeKeys.add(dedupeKey)

    const extractedAt = new Date().toISOString()
    mergedTodos.push({
      id: buildTodoId(recordingId, task, assignee, dueDate),
      task,
      normalized_task: normalizeText(task),
      assignee,
      due_date: dueDate,
      priority: item.priority,
      notes: item.notes,
      status: 'open',
      source_agent: {
        namespace: params.agentNamespace,
        name: params.agentName,
      },
      extracted_at: extractedAt,
      completed_at: null,
      updated_at: extractedAt,
    })

    createdCount += 1
  }

  if (mergedTodos.length > 0 || existingRecordingState) {
    await upsertRecordingTodosState(recordingId, recordingTitle, mergedTodos, existingRecordingState)
  }

  const savedTodos = await listSavedTodosForRecording(recordingId)

  return {
    rawReply: invokeResult.reply,
    parsedCount: parsed.items.length,
    invalidCount: parsed.invalidCount,
    createdCount,
    duplicateCount,
    savedTodos,
  }
}

export async function updateSavedTodoStatus(todo: SavedTodo, nextStatus: TodoStatus): Promise<SavedTodo> {
  const recordingId = todo.value.recording_id.trim()
  if (!recordingId) {
    throw new Error('Recording ID is required to update to-do status.')
  }

  const normalizedStatus: TodoStatus = nextStatus === 'done' ? 'done' : 'open'
  const existingStates = await listTodoStates()
  const { existingRecordingState, todos: baseTodos } = resolveRecordingTodosForMutation(existingStates, recordingId)
  const targetIndex = findTodoIndexBySavedTodo(baseTodos, todo)

  if (targetIndex < 0) {
    throw new Error('Could not find the selected to-do in saved recording state.')
  }

  const nowIso = new Date().toISOString()
  const nextTodos = [...baseTodos]
  const targetEntry = nextTodos[targetIndex]

  nextTodos[targetIndex] = {
    ...targetEntry,
    status: normalizedStatus,
    completed_at: normalizedStatus === 'done' ? nowIso : null,
    updated_at: nowIso,
  }

  const persistedState = await upsertRecordingTodosState(
    recordingId,
    todo.value.recording_title || 'Recording',
    nextTodos,
    existingRecordingState,
  )

  const updatedKey = nextTodos[targetIndex].id
  const updatedSavedTodo = mapRecordingStateToSavedTodos(persistedState).find((entry) => entry.key === updatedKey)
  if (updatedSavedTodo) return updatedSavedTodo

  return {
    ...todo,
    key: updatedKey,
    value: {
      ...todo.value,
      status: normalizedStatus,
      completed_at: normalizedStatus === 'done' ? nowIso : null,
    },
    updatedAt: nowIso,
  }
}

export async function updateSavedTodo(todo: SavedTodo, update: SavedTodoUpdate): Promise<SavedTodo> {
  const recordingId = todo.value.recording_id.trim()
  if (!recordingId) {
    throw new Error('Recording ID is required to update to-do.')
  }

  const nextTask = update.task.trim()
  if (!nextTask) {
    throw new Error('To-do title is required.')
  }

  const nextAssignee = normalizeNullableString(update.assignee)
  const nextDueDate = normalizeDueDate(update.due_date)
  const nextPriority = normalizePriority(update.priority)
  const nextNotes = normalizeNullableString(update.notes)

  const existingStates = await listTodoStates()
  const { existingRecordingState, todos: baseTodos } = resolveRecordingTodosForMutation(existingStates, recordingId)
  const targetIndex = findTodoIndexBySavedTodo(baseTodos, todo)

  if (targetIndex < 0) {
    throw new Error('Could not find the selected to-do in saved recording state.')
  }

  const nextDedupeKey = buildTodoDedupeKey(nextTask, nextAssignee, nextDueDate)
  const duplicateIndex = baseTodos.findIndex(
    (entry, index) =>
      index !== targetIndex && buildTodoDedupeKey(entry.task, entry.assignee, entry.due_date) === nextDedupeKey,
  )
  if (duplicateIndex >= 0) {
    throw new Error('A to-do with the same task, assignee, and due date already exists.')
  }

  const nowIso = new Date().toISOString()
  const nextTodos = [...baseTodos]
  const targetEntry = nextTodos[targetIndex]
  const updatedItem: RecordingTodoItemValue = {
    ...targetEntry,
    id: buildTodoId(recordingId, nextTask, nextAssignee, nextDueDate),
    task: nextTask,
    normalized_task: normalizeText(nextTask),
    assignee: nextAssignee,
    due_date: nextDueDate,
    priority: nextPriority,
    notes: nextNotes,
    updated_at: nowIso,
  }
  nextTodos[targetIndex] = updatedItem

  const persistedState = await upsertRecordingTodosState(
    recordingId,
    todo.value.recording_title || 'Recording',
    nextTodos,
    existingRecordingState,
  )

  const updatedSavedTodo = mapRecordingStateToSavedTodos(persistedState).find((entry) => entry.key === updatedItem.id)
  if (updatedSavedTodo) return updatedSavedTodo

  return {
    ...todo,
    key: updatedItem.id,
    value: {
      ...todo.value,
      task: nextTask,
      normalized_task: normalizeText(nextTask),
      assignee: nextAssignee,
      due_date: nextDueDate,
      priority: nextPriority,
      notes: nextNotes,
    },
    updatedAt: nowIso,
  }
}

export async function deleteSavedTodo(todo: SavedTodo): Promise<void> {
  const recordingId = todo.value.recording_id.trim()
  if (!recordingId) {
    throw new Error('Recording ID is required to delete to-do.')
  }

  const existingStates = await listTodoStates()
  const { existingRecordingState, todos: baseTodos } = resolveRecordingTodosForMutation(existingStates, recordingId)
  const targetIndex = findTodoIndexBySavedTodo(baseTodos, todo)

  if (targetIndex < 0) {
    throw new Error('Could not find the selected to-do in saved recording state.')
  }

  const nextTodos = baseTodos.filter((_, index) => index !== targetIndex)
  await upsertRecordingTodosState(recordingId, todo.value.recording_title || 'Recording', nextTodos, existingRecordingState)
}

export function getTodoErrorMessage(error: unknown, fallback: string): string {
  const setupMessage = getFriendlySetupError(error, 'todos')
  if (setupMessage) return setupMessage

  if (!axios.isAxiosError(error)) {
    if (error instanceof Error && error.message.trim()) {
      return error.message
    }
    return fallback
  }

  if (!error.response) return fallback

  const detail = getApiErrorDetail(error)
  if (detail) return detail

  return error.message || fallback
}
