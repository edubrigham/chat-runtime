/**
 * Durable flush after a chat turn (Track 7.3). Writes usage + the conversation/messages to
 * VPS via the idempotent ingest endpoints (channel='website_chat'). Both ingest clients are
 * non-throwing (at-least-once), so a flush failure never breaks the user's turn.
 *
 * NOTE (C-3): re-ingests the supplied message window keyed by `session_id` each turn; the
 * `client_message_key` per-message dedup (0B.5) is a follow-up once the widget supplies
 * stable message ids.
 */

import type { ModelMessage } from 'ai'
import type { DeploymentConfigResponse, VpsClient } from './agent-core'

export interface FlushArgs {
  vps: VpsClient
  snapshot: DeploymentConfigResponse
  model: string
  conversationId: string
  turnId: string
  startedAt: string
  messages: ModelMessage[]
  replyText: string
  usage?: { inputTokens?: number; outputTokens?: number }
}

function asText(content: ModelMessage['content']): string {
  return typeof content === 'string' ? content : JSON.stringify(content)
}

export async function flushDurable(a: FlushArgs): Promise<void> {
  const endedAt = new Date().toISOString()
  const durationSeconds = Math.max(
    0,
    Math.round((Date.parse(endedAt) - Date.parse(a.startedAt)) / 1000),
  )

  await a.vps.ingestUsage({
    agent_id: a.snapshot.agentId,
    model_id: a.model,
    usage_type: 'website_chat',
    text_input_tokens: a.usage?.inputTokens ?? 0,
    text_output_tokens: a.usage?.outputTokens ?? 0,
    idempotency_key: `${a.conversationId}:${a.turnId}`,
  })

  await a.vps.ingestCall({
    session_id: a.conversationId,
    agent_id: a.snapshot.agentId,
    channel: 'website_chat',
    started_at: a.startedAt,
    ended_at: endedAt,
    duration_seconds: durationSeconds,
    status: 'completed',
    model: a.model,
    events: [
      ...a.messages
        .filter((m) => m.role === 'user')
        .map((m) => ({
          event_type: 'user_message' as const,
          timestamp: a.startedAt,
          content: asText(m.content),
          payload: {},
        })),
      {
        event_type: 'assistant_message' as const,
        timestamp: endedAt,
        content: a.replyText,
        payload: {},
      },
    ],
  })
}
