import { ArrowLeft, Check, Copy, Download, Ellipsis, LoaderCircle, Send } from 'lucide-react'
import { Document, Packer, Paragraph, TextRun } from 'docx'
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type KeyboardEvent, type SVGProps } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../features/auth/use-auth'
import {
  listAgents,
  type AgentSummary,
} from '../lib/agents'
import { ensureAgentVisualSlots } from '../lib/agent-visual-slots'
import {
  extractMessageText,
  getChat,
  isInternalRecordingContextMessage,
  streamChatMessage,
  type ChatMessage,
  type ChatWithMessages,
  type MessageContent,
} from '../lib/chats'
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
import styles from './ChatPage.module.scss'

interface ChatLocationState {
  initialContent?: MessageContent
}

type AgentColorClass =
  | 'agentColorOrange'
  | 'agentColorPink'
  | 'agentColorPurple'
  | 'agentColorViolet'
  | 'agentColorIndigo'
  | 'agentColorCyan'
  | 'agentColorGreen'
  | 'agentColorYellow'

type AgentPlaceholderIcon = ComponentType<SVGProps<SVGSVGElement>>

const AGENT_PLACEHOLDER_ICONS = [
  ArchPlaceholder,
  BlobPlaceholder,
  CirclesSquarePlaceholder,
  CirclesVerticalPlaceholder,
  CoilPlaceholder,
  EllipsesPlaceholder,
  HalfCirclesPlaceholder,
  PetalsPlaceholder,
  PinwheelPlaceholder,
  SemicirclesHorizontalPlaceholder,
  SemicirclesVerticalPlaceholder,
  SparklePlaceholder,
] as const satisfies AgentPlaceholderIcon[]

const AGENT_COLOR_CLASSES: AgentColorClass[] = [
  'agentColorOrange',
  'agentColorPink',
  'agentColorPurple',
  'agentColorViolet',
  'agentColorIndigo',
  'agentColorCyan',
  'agentColorGreen',
  'agentColorYellow',
]

function sortAgents(agents: AgentSummary[]): AgentSummary[] {
  return [...agents].sort((left, right) => {
    if (left.isDefault !== right.isDefault) {
      return left.isDefault ? -1 : 1
    }

    const leftLabel = `${left.namespace}/${left.name}`
    const rightLabel = `${right.namespace}/${right.name}`
    return leftLabel.localeCompare(rightLabel)
  })
}

function getAgentVisualStyle(agentIndex: number): {
  placeholderIcon: AgentPlaceholderIcon
  colorClass: AgentColorClass
} {
  return {
    placeholderIcon: AGENT_PLACEHOLDER_ICONS[agentIndex % AGENT_PLACEHOLDER_ICONS.length],
    colorClass: AGENT_COLOR_CLASSES[agentIndex % AGENT_COLOR_CLASSES.length],
  }
}

function buildAgentVisualStyleFallbackKey(namespace: string | null | undefined, name: string | null | undefined): number {
  const key = `${namespace ?? ''}/${name ?? ''}`.toLowerCase()
  if (!key.trim()) return 0

  let hash = 0
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) >>> 0
  }

  return hash
}

function getApiErrorMessage(error: unknown, fallback: string): string {
  const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail

  if (typeof detail === 'string' && detail.trim()) {
    return detail
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message
  }

  return fallback
}

function isVisibleChatMessage(message: ChatMessage): boolean {
  if (message.role !== 'user' && message.role !== 'assistant') return false

  if (message.role === 'user' && isInternalRecordingContextMessage(message.content)) {
    return false
  }

  return true
}

function getTranscriptRoleLabel(role: string): string {
  return role === 'user' ? 'User' : 'Assistant'
}

function formatTranscriptTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  return date.toLocaleString([], {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function normalizeTranscriptMessageText(value: string): string {
  const trimmed = value.trim()
  return trimmed || '[No text content]'
}

function buildPlainTextChatTranscript(
  chatTitle: string,
  chatSubtitle: string,
  messages: ChatMessage[],
): string {
  const lines: string[] = [chatTitle]

  if (chatSubtitle.trim()) {
    lines.push(`Agent: ${chatSubtitle}`)
  }

  lines.push(`Exported at: ${new Date().toISOString()}`)
  lines.push('')

  for (const message of messages) {
    const text = normalizeTranscriptMessageText(extractMessageText(message.content))
    const roleLabel = getTranscriptRoleLabel(message.role)
    const timestamp = formatTranscriptTimestamp(message.createdAt)

    lines.push(`[${timestamp}] ${roleLabel}`)
    lines.push(text)
    lines.push('')
  }

  return lines.join('\n')
}

function buildTranscriptFileStem(chatTitle: string): string {
  const normalized = chatTitle
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return normalized || 'chat'
}

function buildDocxChatTranscript(
  chatTitle: string,
  chatSubtitle: string,
  messages: ChatMessage[],
): Document {
  const title = chatTitle.trim() || 'Chat'
  const subtitle = chatSubtitle.trim()
  const exportedAt = new Date().toISOString()
  const children: Paragraph[] = []

  children.push(
    new Paragraph({
      children: [new TextRun({ text: title, bold: true, size: 32 })],
      spacing: { after: 120 },
    }),
  )

  if (subtitle) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: `Agent: ${subtitle}`, color: '4B5563' })],
        spacing: { after: 40 },
      }),
    )
  }

  children.push(
    new Paragraph({
      children: [new TextRun({ text: `Exported at: ${exportedAt}`, color: '6B7280' })],
      spacing: { after: 220 },
    }),
  )

  for (const message of messages) {
    const roleLabel = getTranscriptRoleLabel(message.role)
    const timestamp = formatTranscriptTimestamp(message.createdAt)
    const text = normalizeTranscriptMessageText(extractMessageText(message.content))

    children.push(
      new Paragraph({
        children: [new TextRun({ text: `${roleLabel} • ${timestamp}`, bold: true })],
        spacing: { before: 120, after: 60 },
      }),
    )

    const lines = text.split('\n')
    for (const line of lines) {
      children.push(
        new Paragraph({
          children: [new TextRun(line || ' ')],
          spacing: { after: 20 },
        }),
      )
    }

    children.push(new Paragraph({ spacing: { after: 80 } }))
  }

  return new Document({
    sections: [
      {
        children,
      },
    ],
  })
}

export function ChatPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { recordingId, chatId } = useParams<{ recordingId: string; chatId: string }>()
  const { session } = useAuth()
  const locationState = location.state as ChatLocationState | null

  const initialContent = useMemo<MessageContent | undefined>(() => {
    const value = locationState?.initialContent
    if (typeof value === 'string') return value
    if (Array.isArray(value)) return value
    return undefined
  }, [locationState?.initialContent])

  const [chat, setChat] = useState<ChatWithMessages | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isLoadingChat, setIsLoadingChat] = useState(true)
  const [chatError, setChatError] = useState<string | null>(null)
  const [availableAgents, setAvailableAgents] = useState<AgentSummary[]>([])
  const [agentVisualSlots, setAgentVisualSlots] = useState<Record<string, number>>({})

  const [draft, setDraft] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [sendError, setSendError] = useState<string | null>(null)
  const [isPreparingRecap, setIsPreparingRecap] = useState(false)
  const [hasCopiedChat, setHasCopiedChat] = useState(false)
  const [isActionsMenuOpen, setIsActionsMenuOpen] = useState(false)

  const sentInitialByChatRef = useRef<Record<string, boolean>>({})
  const scrollContainerRef = useRef<HTMLElement | null>(null)
  const copyResetTimeoutRef = useRef<number | null>(null)
  const actionsMenuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let isCancelled = false

    const loadAgents = async (): Promise<void> => {
      try {
        const loaded = await listAgents()
        if (isCancelled) return
        const activeAgents = sortAgents(loaded.filter((agent) => agent.isActive))
        const visualSlots = ensureAgentVisualSlots(
          activeAgents.map((agent) => agent.id),
          session?.user.id,
        )
        setAgentVisualSlots(visualSlots)
        setAvailableAgents(activeAgents)
      } catch {
        if (isCancelled) return
        setAvailableAgents([])
        setAgentVisualSlots({})
      }
    }

    void loadAgents()

    return () => {
      isCancelled = true
    }
  }, [session?.user.id])

  const loadChat = useCallback(async (): Promise<void> => {
    if (!chatId) {
      setChat(null)
      setMessages([])
      setChatError('Chat was not found.')
      setIsLoadingChat(false)
      return
    }

    setIsLoadingChat(true)
    setChatError(null)

    try {
      const loaded = await getChat(chatId)
      setChat(loaded)
      setMessages(loaded.messages)
    } catch (error) {
      setChat(null)
      setMessages([])
      setChatError(getApiErrorMessage(error, 'Failed to load chat.'))
    } finally {
      setIsLoadingChat(false)
    }
  }, [chatId])

  useEffect(() => {
    setSendError(null)
    setStreamingContent('')
    setIsPreparingRecap(false)
    void loadChat()
  }, [loadChat])

  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    container.scrollTo({
      top: container.scrollHeight,
      behavior: 'smooth',
    })
  }, [messages, streamingContent])

  useEffect(
    () => () => {
      if (copyResetTimeoutRef.current !== null) {
        window.clearTimeout(copyResetTimeoutRef.current)
        copyResetTimeoutRef.current = null
      }
    },
    [],
  )

  useEffect(() => {
    if (!isActionsMenuOpen) return

    const onPointerDown = (event: MouseEvent): void => {
      const menuElement = actionsMenuRef.current
      const targetNode = event.target as Node | null
      if (!menuElement || !targetNode) return

      if (!menuElement.contains(targetNode)) {
        setIsActionsMenuOpen(false)
      }
    }

    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setIsActionsMenuOpen(false)
      }
    }

    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [isActionsMenuOpen])

  const sendMessage = useCallback(
    async (content: MessageContent, options?: { hideUserMessage?: boolean }): Promise<void> => {
      if (!chatId || isSending) return

      const hideUserMessage = Boolean(options?.hideUserMessage)

      setIsSending(true)
      setSendError(null)
      setStreamingContent('')

      if (!hideUserMessage) {
        const optimisticUserMessage: ChatMessage = {
          id: `temp-user-${Date.now()}`,
          chatId,
          role: 'user',
          content,
          toolCalls: null,
          toolCallId: null,
          name: null,
          createdAt: new Date().toISOString(),
        }

        setMessages((previous) => [...previous, optimisticUserMessage])
      }

      try {
        await streamChatMessage(chatId, content, {
          onChunkContent: (chunk) => {
            setStreamingContent((previous) =>
              chunk.mode === 'replace' ? chunk.text : `${previous}${chunk.text}`,
            )
          },
        })

        await loadChat()
      } catch (error) {
        setSendError(getApiErrorMessage(error, 'Failed to send message.'))
        await loadChat()
      } finally {
        setIsSending(false)
        setStreamingContent('')
      }
    },
    [chatId, isSending, loadChat],
  )

  useEffect(() => {
    if (!chatId) return
    if (initialContent === undefined) return
    if (isLoadingChat || chatError) return

    const hasUserMessages = messages.some((message) => message.role === 'user')
    if (hasUserMessages) {
      sentInitialByChatRef.current[chatId] = true
      return
    }

    if (sentInitialByChatRef.current[chatId]) return
    sentInitialByChatRef.current[chatId] = true

    setIsPreparingRecap(true)
    void sendMessage(initialContent, { hideUserMessage: true }).finally(() => {
      setIsPreparingRecap(false)
    })
  }, [chatError, chatId, initialContent, isLoadingChat, messages, sendMessage])

  const visibleMessages = useMemo(
    () => messages.filter((message) => isVisibleChatMessage(message)),
    [messages],
  )

  const chatTitle = chat?.title?.trim() || 'Chat'
  const chatSubtitle = chat?.agentName?.trim()
    ? `${chat.agentNamespace || 'agent'}/${chat.agentName}`
    : 'Agent chat'

  const selectedAgent = useMemo(() => {
    if (!chat) return null

    if (chat.agentId) {
      const byId = availableAgents.find((agent) => agent.id === chat.agentId)
      if (byId) return byId
    }

    const normalizedNamespace = chat.agentNamespace?.trim().toLowerCase()
    const normalizedName = chat.agentName?.trim().toLowerCase()
    if (!normalizedNamespace || !normalizedName) return null

    return (
      availableAgents.find(
        (agent) =>
          agent.namespace.trim().toLowerCase() === normalizedNamespace &&
          agent.name.trim().toLowerCase() === normalizedName,
      ) ?? null
    )
  }, [availableAgents, chat])

  const assistantVisualStyle = useMemo(() => {
    if (selectedAgent) {
      const slot = agentVisualSlots[selectedAgent.id]
      if (typeof slot === 'number') {
        return getAgentVisualStyle(slot)
      }
    }

    const fallbackIndex = buildAgentVisualStyleFallbackKey(chat?.agentNamespace, chat?.agentName)
    return getAgentVisualStyle(fallbackIndex)
  }, [agentVisualSlots, chat?.agentName, chat?.agentNamespace, selectedAgent])

  const assistantIconUrl = selectedAgent?.iconUrl?.trim() || null
  const AssistantPlaceholderIcon = assistantVisualStyle.placeholderIcon
  const assistantColorClass = assistantVisualStyle.colorClass

  const canSubmit = draft.trim().length > 0 && !isSending
  const hasTranscriptMessages = visibleMessages.length > 0

  const submitDraft = (): void => {
    const trimmed = draft.trim()
    if (!trimmed || isSending) return

    setDraft('')
    void sendMessage(trimmed)
  }

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== 'Enter' || event.shiftKey) return

    event.preventDefault()
    submitDraft()
  }

  const copyChatTranscript = async (): Promise<void> => {
    if (!hasTranscriptMessages || !navigator.clipboard?.writeText) return

    setIsActionsMenuOpen(false)
    const transcript = buildPlainTextChatTranscript(chatTitle, chatSubtitle, visibleMessages)

    try {
      await navigator.clipboard.writeText(transcript)
      setHasCopiedChat(true)

      if (copyResetTimeoutRef.current !== null) {
        window.clearTimeout(copyResetTimeoutRef.current)
      }

      copyResetTimeoutRef.current = window.setTimeout(() => {
        setHasCopiedChat(false)
      }, 1800)
    } catch {
      setHasCopiedChat(false)
    }
  }

  const exportChatTranscriptAsDocx = async (): Promise<void> => {
    if (!hasTranscriptMessages) return

    setIsActionsMenuOpen(false)

    try {
      const document = buildDocxChatTranscript(chatTitle, chatSubtitle, visibleMessages)
      const blob = await Packer.toBlob(document)
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const fileName = `${buildTranscriptFileStem(chatTitle)}-${timestamp}.docx`
      const objectUrl = window.URL.createObjectURL(blob)
      const anchor = window.document.createElement('a')

      anchor.href = objectUrl
      anchor.download = fileName
      anchor.click()

      window.setTimeout(() => {
        window.URL.revokeObjectURL(objectUrl)
      }, 0)
    } catch (error) {
      console.error('Failed to export chat transcript as DOCX.', error)
    }
  }

  return (
    <div className={`app-root ${styles.layout}`}>
      <main className={styles.main}>
        <div className={styles.chatShell}>
          <header className={styles.pageHeader}>
            <button
              type='button'
              className={styles.backButton}
              onClick={() => void navigate(recordingId ? `/recordings/${recordingId}` : '/')}
              aria-label='Back to recording'
            >
              <ArrowLeft size={18} />
            </button>

            <div className={styles.pageHeaderText}>
              <h1 className={styles.pageTitle}>{chatTitle}</h1>
              <p className={styles.pageSubtitle}>{chatSubtitle}</p>
            </div>

            <div ref={actionsMenuRef} className={styles.pageHeaderActions}>
              <button
                type='button'
                className={styles.actionsToggleButton}
                onClick={() => setIsActionsMenuOpen((current) => !current)}
                aria-haspopup='menu'
                aria-expanded={isActionsMenuOpen}
                aria-label='Chat actions'
              >
                <Ellipsis size={18} />
              </button>

              {isActionsMenuOpen ? (
                <div className={styles.actionsMenu} role='menu' aria-label='Chat actions'>
                  <button
                    type='button'
                    className={styles.actionsMenuItem}
                    role='menuitem'
                    onClick={() => void copyChatTranscript()}
                    disabled={!hasTranscriptMessages}
                  >
                    {hasCopiedChat ? <Check size={14} /> : <Copy size={14} />}
                    <span>{hasCopiedChat ? 'Copied' : 'Copy'}</span>
                  </button>

                  <button
                    type='button'
                    className={styles.actionsMenuItem}
                    role='menuitem'
                    onClick={() => void exportChatTranscriptAsDocx()}
                    disabled={!hasTranscriptMessages}
                  >
                    <Download size={14} />
                    <span>Export DOCX</span>
                  </button>
                </div>
              ) : null}
            </div>
          </header>

          <section ref={scrollContainerRef} className={styles.messages}>
            {isLoadingChat ? <p className={styles.stateText}>Loading chat...</p> : null}

            {!isLoadingChat && chatError ? (
              <div className={styles.errorBlock}>
                <p className={styles.errorText}>{chatError}</p>
                <button
                  type='button'
                  className={styles.retryButton}
                  onClick={() => void loadChat()}
                >
                  Retry
                </button>
              </div>
            ) : null}

            {!isLoadingChat && !chatError && visibleMessages.length === 0 && !isSending ? (
              <p className={styles.stateText}>No messages yet.</p>
            ) : null}

            {!isLoadingChat && !chatError && visibleMessages.length > 0 ? (
              <ul className={styles.messagesList}>
                {visibleMessages.map((message) => {
                  const text = extractMessageText(message.content).trim()
                  const isUserMessage = message.role === 'user'

                  return (
                    <li
                      key={message.id}
                      className={`${styles.messageRow} ${isUserMessage ? styles.userRow : styles.assistantRow}`}
                    >
                      {!isUserMessage ? (
                        <span className={`${styles.assistantAvatar} ${styles[assistantColorClass]}`} aria-hidden='true'>
                          {assistantIconUrl ? (
                            <img
                              className={styles.assistantAvatarImage}
                              src={assistantIconUrl}
                              alt=''
                              loading='lazy'
                            />
                          ) : (
                            <AssistantPlaceholderIcon className={styles.assistantAvatarPlaceholder} focusable='false' />
                          )}
                        </span>
                      ) : null}

                      <article className={`${styles.message} ${isUserMessage ? styles.userMsg : styles.assistantMsg}`}>
                        {isUserMessage ? (
                          <p className={styles.messageText}>{text || '[No text content]'}</p>
                        ) : (
                          <div className={styles.messageMarkdown}>
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {text || '[No text content]'}
                            </ReactMarkdown>
                          </div>
                        )}
                      </article>
                    </li>
                  )
                })}
              </ul>
            ) : null}

            {!isLoadingChat && !chatError && isSending ? (
              <div className={`${styles.messageRow} ${styles.assistantRow}`}>
                <span
                  className={`${styles.assistantAvatar} ${styles[assistantColorClass]} ${styles.assistantAvatarPulse}`}
                  aria-hidden='true'
                >
                  {assistantIconUrl ? (
                    <img
                      className={styles.assistantAvatarImage}
                      src={assistantIconUrl}
                      alt=''
                      loading='lazy'
                    />
                  ) : (
                    <AssistantPlaceholderIcon className={styles.assistantAvatarPlaceholder} focusable='false' />
                  )}
                </span>
                <article className={`${styles.message} ${styles.assistantMsg}`}>
                  {streamingContent ? (
                    <div className={styles.messageMarkdown}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {streamingContent}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <p className={styles.stateTextInline}>
                      {isPreparingRecap ? 'Preparing recap...' : 'Thinking...'}
                    </p>
                  )}
                </article>
              </div>
            ) : null}
          </section>

          <section className={styles.composerWrap}>
            <div className={styles.composer}>
              <textarea
                className={styles.input}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={onComposerKeyDown}
                placeholder={isPreparingRecap ? 'Preparing recap...' : 'Ask something...'}
                rows={2}
                disabled={isSending || Boolean(chatError) || isLoadingChat}
              />
              <button
                type='button'
                className={styles.sendButton}
                onClick={submitDraft}
                disabled={!canSubmit}
                aria-label='Send message'
              >
                {isSending ? (
                  <LoaderCircle size={18} className={styles.sendSpinner} />
                ) : (
                  <Send size={18} />
                )}
              </button>
            </div>

            {sendError ? <p className={styles.errorText}>{sendError}</p> : null}
          </section>
        </div>
      </main>
    </div>
  )
}
