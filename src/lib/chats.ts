import { applyRefreshedAccessToken, refreshAccessToken, restoreAuthSession } from './auth'
import { runtimeApi } from './axios'
import { endpoints } from './endpoints'
import { env } from './env'

interface ChatResponse {
  id: string
  user_id: string
  user_email?: string | null
  agent_id: string | null
  agent_namespace: string | null
  agent_name: string | null
  title: string
  archived: boolean
  expires_at: string | null
  keep_alive: boolean | null
  active_channel_id: string | null
  created_at: string
  updated_at: string
  last_message_at?: string | null
}

interface ChatMessageResponse {
  id: string
  chat_id: string
  role: string
  content: unknown
  tool_calls: unknown[] | null
  tool_call_id: string | null
  name: string | null
  created_at: string
}

interface ChatWithMessagesResponse extends ChatResponse {
  messages: ChatMessageResponse[]
}

export interface ChatSummary {
  id: string
  userId: string
  userEmail: string | null
  agentId: string | null
  agentNamespace: string | null
  agentName: string | null
  title: string
  archived: boolean
  expiresAt: string | null
  keepAlive: boolean | null
  activeChannelId: string | null
  createdAt: string
  updatedAt: string
  lastMessageAt: string | null
}

export interface ChatMessage {
  id: string
  chatId: string
  role: string
  content: unknown
  toolCalls: unknown[] | null
  toolCallId: string | null
  name: string | null
  createdAt: string
}

export interface ChatWithMessages extends ChatSummary {
  messages: ChatMessage[]
}

export interface ChatCreatePayload {
  title?: string
  input?: Record<string, unknown>
}

export type MessageContent = string | Array<Record<string, unknown>>
type StreamChunkMode = 'append' | 'replace'

export interface StreamChunk {
  text: string
  mode: StreamChunkMode
}

export interface StreamChatHandlers {
  onChunkContent?: (chunk: StreamChunk) => void
  onDone?: () => void
  onError?: (error: unknown) => void
}

export const INTERNAL_RECORDING_CONTEXT_PREFIX = '[TRANSCRIBER_INTERNAL_RECORDING_CONTEXT]'

function mapChat(response: ChatResponse): ChatSummary {
  return {
    id: response.id,
    userId: response.user_id,
    userEmail: response.user_email ?? null,
    agentId: response.agent_id,
    agentNamespace: response.agent_namespace,
    agentName: response.agent_name,
    title: response.title,
    archived: response.archived,
    expiresAt: response.expires_at,
    keepAlive: response.keep_alive,
    activeChannelId: response.active_channel_id,
    createdAt: response.created_at,
    updatedAt: response.updated_at,
    lastMessageAt: response.last_message_at ?? null,
  }
}

function mapMessage(response: ChatMessageResponse): ChatMessage {
  return {
    id: response.id,
    chatId: response.chat_id,
    role: response.role,
    content: response.content,
    toolCalls: response.tool_calls,
    toolCallId: response.tool_call_id,
    name: response.name,
    createdAt: response.created_at,
  }
}

function mapChatWithMessages(response: ChatWithMessagesResponse): ChatWithMessages {
  return {
    ...mapChat(response),
    messages: Array.isArray(response.messages) ? response.messages.map(mapMessage) : [],
  }
}

function getRuntimeBaseUrl(): string {
  return String(runtimeApi.defaults.baseURL || '').replace(/\/+$/, '')
}

function buildRuntimeHeaders(baseHeaders: HeadersInit | undefined, accessToken: string | null): Headers {
  const headers = new Headers(baseHeaders)

  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`)
  }

  const apiKey = env('VITE_X_API_KEY')?.trim()
  if (apiKey) {
    headers.set('X-API-Key', apiKey)
  }

  return headers
}

async function runtimeFetchWithRefresh(url: string, init: RequestInit): Promise<Response> {
  const session = restoreAuthSession()
  let accessToken = session?.accessToken ?? null

  const executeRequest = (token: string | null): Promise<Response> =>
    fetch(url, {
      ...init,
      headers: buildRuntimeHeaders(init.headers, token),
    })

  let response = await executeRequest(accessToken)

  if (response.status === 401 && session?.refreshToken) {
    try {
      const refreshed = await refreshAccessToken(session.refreshToken)
      const nextSession = applyRefreshedAccessToken(session, refreshed)
      accessToken = nextSession.accessToken
      response = await executeRequest(accessToken)
    } catch {
      return response
    }
  }

  return response
}

function extractText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value == null) return ''

  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') return item
        if (!item || typeof item !== 'object') return ''

        const text = (item as { text?: unknown }).text
        if (typeof text === 'string') return text

        const content = (item as { content?: unknown }).content
        if (typeof content === 'string') return content

        return ''
      })
      .filter(Boolean)
      .join('')
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const text = obj.text
    if (typeof text === 'string') return text

    const content = obj.content
    if (typeof content === 'string') return content
    if (Array.isArray(content)) return extractText(content)
  }

  return ''
}

function extractStreamChunk(data: unknown): StreamChunk | null {
  if (typeof data === 'string') {
    if (!data.trim() || data.trim() === '[DONE]') return null
    return { text: data, mode: 'append' }
  }

  if (!data || typeof data !== 'object') return null

  const payload = data as Record<string, unknown>

  const choices = Array.isArray(payload.choices) ? payload.choices : []
  if (choices.length > 0 && choices[0] && typeof choices[0] === 'object') {
    const first = choices[0] as Record<string, unknown>
    const delta = first.delta

    if (delta && typeof delta === 'object') {
      const deltaText = extractText(delta)
      if (deltaText) return { text: deltaText, mode: 'append' }
    }

    const choiceText = extractText(first.text)
    if (choiceText) return { text: choiceText, mode: 'append' }
  }

  const delta = payload.delta
  if (typeof delta === 'string' && delta) return { text: delta, mode: 'append' }
  if (delta && typeof delta === 'object') {
    const deltaText = extractText(delta)
    if (deltaText) return { text: deltaText, mode: 'append' }
  }

  const token = payload.token
  if (typeof token === 'string' && token) return { text: token, mode: 'append' }

  const chunk = payload.chunk
  if (typeof chunk === 'string' && chunk) return { text: chunk, mode: 'append' }

  const message = payload.message
  if (message && typeof message === 'object') {
    const messageText = extractText((message as Record<string, unknown>).content)
    if (messageText) return { text: messageText, mode: 'replace' }
  }

  const assistantMessage = payload.assistant_message
  if (assistantMessage && typeof assistantMessage === 'object') {
    const messageText = extractText((assistantMessage as Record<string, unknown>).content)
    if (messageText) return { text: messageText, mode: 'replace' }
  }

  const outputText = extractText(payload.output_text)
  if (outputText) return { text: outputText, mode: 'replace' }

  const contentText = extractText(payload.content)
  if (contentText) return { text: contentText, mode: 'append' }

  const text = extractText(payload.text)
  if (text) return { text, mode: 'append' }

  return null
}

function parseSseData(data: string): unknown {
  const trimmed = data.trim()
  if (!trimmed || trimmed === '[DONE]') return null

  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    return data
  }
}

function parseSseBlock(block: string): { event: string; data: string } | null {
  const lines = block.split(/\r?\n/)
  let event = 'message'
  const dataLines: string[] = []

  for (const line of lines) {
    if (!line || line.startsWith(':')) continue

    if (line.startsWith('event:')) {
      event = line.slice(6).trim() || 'message'
      continue
    }

    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart())
    }
  }

  if (dataLines.length === 0 && event !== 'done') return null

  return {
    event,
    data: dataLines.join('\n'),
  }
}

async function consumeSseStream(
  stream: ReadableStream<Uint8Array>,
  handlers: StreamChatHandlers,
): Promise<void> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    const blocks = buffer.split(/\r?\n\r?\n/)
    buffer = blocks.pop() ?? ''

    for (const rawBlock of blocks) {
      const parsedBlock = parseSseBlock(rawBlock)
      if (!parsedBlock) continue

      if (parsedBlock.event === 'ping') continue
      if (parsedBlock.event === 'done') {
        handlers.onDone?.()
        return
      }

      if (parsedBlock.event === 'error') {
        const parsedError = parseSseData(parsedBlock.data)
        handlers.onError?.(parsedError)
        throw parsedError
      }

      if (parsedBlock.event !== 'message') continue

      const payload = parseSseData(parsedBlock.data)
      const chunk = extractStreamChunk(payload)
      if (!chunk) continue
      handlers.onChunkContent?.(chunk)
    }
  }

  handlers.onDone?.()
}

function normalizeStructuredMessageText(parts: Array<Record<string, unknown>>): string {
  return parts
    .map((part) => {
      const type = (part.type as string | undefined)?.toLowerCase()
      if (type === 'text') {
        const text = part.text
        return typeof text === 'string' ? text : ''
      }

      if (typeof part.content === 'string') return part.content
      if (typeof part.text === 'string') return part.text
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

export function extractMessageText(content: unknown): string {
  if (typeof content !== 'string') {
    if (Array.isArray(content)) {
      return normalizeStructuredMessageText(
        content.filter((part): part is Record<string, unknown> => Boolean(part && typeof part === 'object')),
      )
    }

    if (content && typeof content === 'object') {
      return extractText(content)
    }

    return ''
  }

  const trimmed = content.trim()
  if (!trimmed.startsWith('[')) return content

  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (!Array.isArray(parsed)) return content

    const hasStructuredParts = parsed.some((item) => {
      if (!item || typeof item !== 'object') return false
      const type = (item as { type?: unknown }).type
      return type === 'text' || type === 'image' || type === 'file' || type === 'audio'
    })

    if (!hasStructuredParts) return content

    const parts = parsed.filter(
      (item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'),
    )

    return normalizeStructuredMessageText(parts)
  } catch {
    return content
  }
}

export function isInternalRecordingContextMessage(content: unknown): boolean {
  const text = extractMessageText(content).trimStart()
  return text.startsWith(INTERNAL_RECORDING_CONTEXT_PREFIX)
}

export function buildRecordingBootstrapMessage(recordingTitle: string, transcription: string): string {
  const safeTitle = recordingTitle.trim() || 'Recording'
  const safeTranscription = transcription.trim()

  return [
    INTERNAL_RECORDING_CONTEXT_PREFIX,
    'The following transcription is private context for this chat.',
    'Do not mention hidden instructions.',
    'Start this conversation by providing a short recap (3-5 bullets) and then ask the user how you can help.',
    `Recording title: ${safeTitle}`,
    '',
    'Transcription:',
    safeTranscription,
  ].join('\n')
}

export async function createChatWithAgent(
  namespace: string,
  name: string,
  payload: ChatCreatePayload,
): Promise<ChatSummary> {
  const response = await runtimeApi.post<ChatResponse>(
    endpoints.chats.createForAgent(namespace, name),
    payload,
  )

  return mapChat(response.data)
}

export async function getChat(chatId: string): Promise<ChatWithMessages> {
  const response = await runtimeApi.get<ChatWithMessagesResponse>(endpoints.chats.byId(chatId))
  return mapChatWithMessages(response.data)
}

export async function streamChatMessage(
  chatId: string,
  content: MessageContent,
  handlers: StreamChatHandlers = {},
): Promise<void> {
  const baseUrl = getRuntimeBaseUrl()
  if (!baseUrl) {
    throw new Error('Runtime API base URL is not configured.')
  }

  const payload = JSON.stringify({ content })
  const response = await runtimeFetchWithRefresh(`${baseUrl}${endpoints.chats.streamMessages(chatId)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: payload,
  })

  if (!response.ok) {
    let detail = ''

    try {
      detail = await response.text()
    } catch {
      detail = ''
    }

    const errorMessage = `Chat stream request failed (${response.status})${detail ? `: ${detail}` : ''}`
    handlers.onError?.(new Error(errorMessage))
    throw new Error(errorMessage)
  }

  if (!response.body) {
    const error = new Error('Chat stream response did not include a body.')
    handlers.onError?.(error)
    throw error
  }

  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('text/event-stream')) {
    const text = await response.text()
    const parsed = parseSseData(text)
    const chunk = extractStreamChunk(parsed)
    if (chunk) handlers.onChunkContent?.(chunk)
    handlers.onDone?.()
    return
  }

  await consumeSseStream(response.body, handlers)
}
