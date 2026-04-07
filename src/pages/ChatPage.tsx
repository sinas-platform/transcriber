import { ArrowLeft, LoaderCircle, Send } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type KeyboardEvent, type SVGProps } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  listAgents,
  type AgentSummary,
} from '../lib/agents'
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

export function ChatPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { recordingId, chatId } = useParams<{ recordingId: string; chatId: string }>()
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

  const [draft, setDraft] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [sendError, setSendError] = useState<string | null>(null)
  const [isPreparingRecap, setIsPreparingRecap] = useState(false)

  const sentInitialByChatRef = useRef<Record<string, boolean>>({})
  const scrollContainerRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    let isCancelled = false

    const loadAgents = async (): Promise<void> => {
      try {
        const loaded = await listAgents()
        if (isCancelled) return
        setAvailableAgents(sortAgents(loaded.filter((agent) => agent.isActive)))
      } catch {
        if (isCancelled) return
        setAvailableAgents([])
      }
    }

    void loadAgents()

    return () => {
      isCancelled = true
    }
  }, [])

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
      const index = availableAgents.findIndex((agent) => agent.id === selectedAgent.id)
      if (index >= 0) return getAgentVisualStyle(index)
    }

    const fallbackIndex = buildAgentVisualStyleFallbackKey(chat?.agentNamespace, chat?.agentName)
    return getAgentVisualStyle(fallbackIndex)
  }, [availableAgents, chat?.agentName, chat?.agentNamespace, selectedAgent])

  const assistantIconUrl = selectedAgent?.iconUrl?.trim() || null
  const AssistantPlaceholderIcon = assistantVisualStyle.placeholderIcon
  const assistantColorClass = assistantVisualStyle.colorClass

  const canSubmit = draft.trim().length > 0 && !isSending

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
