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
import { createVpsClient, type VpsClient, type DeploymentConfigResponse } from './agent-core'
import { createChatModel } from './model'
import { buildTools } from './tools'
import { flushDurable } from './ingest'
import { corsHeadersForOrigin, isOriginAllowed } from './origin'

function asText(content: ModelMessage['content']): string {
  return typeof content === 'string' ? content : JSON.stringify(content)
}

export interface AppDeps {
  vps: VpsClient
}

interface ChatRequestBody {
  deploymentId?: string
  /** Browser-widget path: resolves to the internal id server-side; never the internal id. */
  publicDeploymentId?: string
  conversationId?: string
  messages?: ModelMessage[]
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono()

  app.get('/health', (c) => c.json({ ok: true, service: 'chat-runtime' }))

  // Browser preflight for the public widget path. Always 204 + reflected CORS.
  app.options('/chat', (c) => {
    const origin = c.req.header('origin')
    return new Response(null, {
      status: 204,
      headers: origin ? corsHeadersForOrigin(origin) : {},
    })
  })

  app.post('/chat', async (c) => {
    let body: ChatRequestBody
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400)
    }

    const { deploymentId, publicDeploymentId, messages } = body
    if (!Array.isArray(messages) || messages.length === 0) {
      return c.json({ error: 'a non-empty messages[] is required' }, 400)
    }

    // The PUBLIC (browser-widget) path is keyed by the safe public id and is Origin-
    // allowlisted; its responses carry CORS so the browser can read the stream. The internal
    // path is unchanged (server-to-server, no CORS). `cors` is set only on the public path.
    const origin = c.req.header('origin')
    let snapshot: DeploymentConfigResponse
    let cors: Record<string, string> | undefined

    if (publicDeploymentId) {
      try {
        snapshot = await deps.vps.getPublicDeploymentConfig(publicDeploymentId)
      } catch (err) {
        return c.json({ error: err instanceof Error ? err.message : 'config fetch failed' }, 502)
      }

      // Origin gate (deny-by-default once an allowlist exists). A MISSING Origin must be
      // rejected too — otherwise a non-browser client (curl/server-side) bypasses the
      // allowlist by simply omitting the header. (Empty allowlist stays permissive until
      // the deploy surface writes origins — see #2/config FOLLOW-UP.)
      const allowed = snapshot.allowedOrigins ?? []
      if (allowed.length > 0 && (!origin || !isOriginAllowed(origin, allowed))) {
        return c.json(
          { error: 'origin not allowed' },
          403,
          origin ? corsHeadersForOrigin(origin) : undefined,
        )
      }
      cors = origin ? corsHeadersForOrigin(origin) : undefined
    } else if (deploymentId) {
      // Pinned snapshot (cached + ETag-revalidated) — chat_runtime/text only.
      try {
        snapshot = await deps.vps.getDeploymentConfig(deploymentId)
      } catch (err) {
        return c.json({ error: err instanceof Error ? err.message : 'config fetch failed' }, 502)
      }
    } else {
      return c.json({ error: 'deploymentId or publicDeploymentId is required' }, 400)
    }

    // Downstream calls (credentials, tools) always key on the INTERNAL id from the resolved
    // snapshot — for the public path this is the resolved id, never the public id.
    const effectiveDeploymentId = snapshot.deploymentId

    const session = snapshot.config.session
    if (session.kind !== 'text') {
      return c.json({ error: `unsupported channel session: ${session.kind}` }, 400, cors)
    }

    // Per-project LLM key (Option A): runtime calls the provider directly.
    let creds
    try {
      creds = await deps.vps.getLlmCredentials(effectiveDeploymentId, session.model)
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'credentials failed' }, 502, cors)
    }
    if (!creds.apiKey) {
      // Azure / non-key providers not wired yet (key-based providers only for now).
      return c.json(
        { error: 'no usable LLM key for this model (Azure not supported yet)' },
        501,
        cors,
      )
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
            effectiveDeploymentId,
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
      agentCore.tools.length > 0
        ? buildTools(effectiveDeploymentId, agentCore.tools, deps.vps)
        : undefined

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

    // CORS (public path only) is attached to the streamed Response via ResponseInit so the
    // browser can read the body cross-origin. The internal path passes no headers (undefined).
    return result.toTextStreamResponse(cors ? { headers: cors } : undefined)
  })

  return app
}

/** Build the app from environment (the default wiring). */
export function createAppFromEnv(env: { vpsBaseUrl: string; runtimeSecret: string }): Hono {
  const vps = createVpsClient({ baseUrl: env.vpsBaseUrl, runtimeSecret: env.runtimeSecret })
  return createApp({ vps })
}
