import { endpoints } from './endpoints'
import { runtimeApi } from './axios'

interface AgentResponse {
  id: string
  namespace: string
  name: string
  description: string | null
  is_active: boolean
  is_default: boolean
  icon_url: string | null
}

interface InvokeAgentResponse {
  reply: string
  chat_id: string
  session_key?: string | null
  usage?: Record<string, unknown> | null
}

export interface AgentSummary {
  id: string
  namespace: string
  name: string
  description: string | null
  isActive: boolean
  isDefault: boolean
  iconUrl: string | null
}

export type AudioFormat = 'wav' | 'mp3' | 'm4a' | 'ogg'

export async function listAgents(): Promise<AgentSummary[]> {
  const response = await runtimeApi.get<AgentResponse[]>(endpoints.config.agents)

  return response.data.map((agent) => ({
    id: agent.id,
    namespace: agent.namespace,
    name: agent.name,
    description: agent.description,
    isActive: agent.is_active,
    isDefault: agent.is_default,
    iconUrl: agent.icon_url,
  }))
}

export async function invokeAgentForTranscription(
  namespace: string,
  name: string,
  audioBase64: string,
  format: AudioFormat,
): Promise<string> {
  const response = await runtimeApi.post<InvokeAgentResponse>(
    endpoints.chats.invokeAgent(namespace, name),
    {
      message: [
        {
          type: 'text',
          text: 'Transcribe this audio exactly. Return only transcription text. If unclear, mark [inaudible].',
        },
        {
          type: 'audio',
          data: audioBase64,
          format,
        },
      ],
    },
  )

  return response.data.reply
}

export function pickTranscriptionAudioFormat(contentType: string): AudioFormat | null {
  const normalized = contentType.toLowerCase()

  if (normalized.includes('wav')) return 'wav'
  if (normalized.includes('mpeg') || normalized.includes('mp3')) return 'mp3'
  if (normalized.includes('mp4') || normalized.includes('m4a') || normalized.includes('aac')) return 'm4a'
  if (normalized.includes('ogg')) return 'ogg'

  return null
}
