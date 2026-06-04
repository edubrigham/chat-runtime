/**
 * Website-chat runtime — the Hono app (runtime-agnostic: serverless or Node server).
 *
 * POST /chat runs ONE in-request streaming turn (Track 7.2): fetch the pinned snapshot +
 * the project's LLM key from VPS, then stream a reply with `streamText`. Stateless — no
 * Redis/queue/worker (D6); conversation history is supplied by the client (durable storage
 * via ingest lands in C-3). Tools/knowledge/ingest are wired in C-3.
 */

import { Hono } from 'hono'
import { streamText, stepCountIs, type ModelMessage } from 'ai'
import { createVpsClient, type VpsClient } from './agent-core'
import { createChatModel } from './model'
import { buildTools } from './tools'
import { flushDurable } from './ingest'

function asText(content: ModelMessage['content']): string {
  return typeof content === 'string' ? content : JSON.stringify(content)
}

export interface AppDeps {
  vps: VpsClient
}

interface ChatRequestBody {
  deploymentId?: string
  conversationId?: string
  messages?: ModelMessage[]
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono()

  app.get('/health', (c) => c.json({ ok: true, service: 'chat-runtime' }))

  app.post('/chat', async (c) => {
    let body: ChatRequestBody
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400)
    }

    const { deploymentId, messages } = body
    if (!deploymentId || !Array.isArray(messages) || messages.length === 0) {
      return c.json({ error: 'deploymentId and a non-empty messages[] are required' }, 400)
    }

    // Pinned snapshot (cached + ETag-revalidated) — chat_runtime/text only.
    let snapshot
    try {
      snapshot = await deps.vps.getDeploymentConfig(deploymentId)
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'config fetch failed' }, 502)
    }

    const session = snapshot.config.session
    if (session.kind !== 'text') {
      return c.json({ error: `unsupported channel session: ${session.kind}` }, 400)
    }

    // Per-project LLM key (Option A): runtime calls the provider directly.
    let creds
    try {
      creds = await deps.vps.getLlmCredentials(deploymentId, session.model)
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'credentials failed' }, 502)
    }
    if (!creds.apiKey) {
      // Azure / non-key providers not wired yet (key-based providers only for now).
      return c.json({ error: 'no usable LLM key for this model (Azure not supported yet)' }, 501)
    }

    const conversationId = body.conversationId || crypto.randomUUID()
    const turnId = crypto.randomUUID()
    const startedAt = new Date().toISOString()
    const agentCore = snapshot.config.agentCore

    // The full compiled prompt (systemInstructions) already includes the flow for text
    // channels — chat bakes the whole flow into the prompt rather than loading steps
    // dynamically (cheap model ⇒ prompt size is not a constraint).
    let system = agentCore.systemInstructions

    // Knowledge: retrieve context for the latest user message and prepend it (non-fatal).
    if (agentCore.hasKnowledge && agentCore.boundKnowledgeIds.length > 0) {
      const lastUser = [...messages].reverse().find((m) => m.role === 'user')
      if (lastUser) {
        try {
          const k = await deps.vps.retrieveKnowledge(
            deploymentId,
            asText(lastUser.content),
            agentCore.boundKnowledgeIds,
          )
          if (k.context) system = `${system}\n\n## Relevant Knowledge\n${k.context}`
        } catch {
          // knowledge is best-effort — never fail the turn on a retrieval hiccup
        }
      }
    }

    // Tools stay bound to their flow steps and are called interactively (the model invokes
    // them as the in-prompt flow reaches that step). Multi-step loop, capped.
    const tools =
      agentCore.tools.length > 0 ? buildTools(deploymentId, agentCore.tools, deps.vps) : undefined

    const result = streamText({
      model: createChatModel(creds),
      system,
      messages,
      maxOutputTokens: session.maxResponseTokens,
      ...(tools ? { tools, stopWhen: stepCountIs(5) } : {}),
      onFinish: async ({ text, usage }) => {
        await flushDurable({
          vps: deps.vps,
          snapshot,
          model: creds.model,
          conversationId,
          turnId,
          startedAt,
          messages,
          replyText: text,
          usage,
        })
      },
    })

    return result.toTextStreamResponse()
  })

  return app
}

/** Build the app from environment (the default wiring). */
export function createAppFromEnv(env: { vpsBaseUrl: string; runtimeSecret: string }): Hono {
  const vps = createVpsClient({ baseUrl: env.vpsBaseUrl, runtimeSecret: env.runtimeSecret })
  return createApp({ vps })
}
