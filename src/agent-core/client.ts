/**
 * VPS HTTP client (HTTP-only — no DB access, decision D5/BL3). The channel runtime uses this
 * to: fetch the pinned config snapshot (with a per-instance LRU mirror + ETag revalidation,
 * matching the voice `/config` refresh model, D6/D7), execute tools, retrieve knowledge, and
 * flush durable conversation/usage records via the idempotent ingest endpoints.
 *
 * One Bearer secret (the per-runtime `RUNTIME_CONFIG_SECRET`) authenticates every call.
 */

import { LRUCache } from 'lru-cache'
import type {
  DeploymentConfigResponse,
  KnowledgeResult,
  LlmCredentials,
  ToolExecuteResult,
} from './types.js'

export interface VpsClientOptions {
  /** VPS base URL, e.g. https://app.example.com (no trailing slash needed). */
  baseUrl: string
  /** Per-runtime secret — sent as `Authorization: Bearer …`. */
  runtimeSecret: string
  /** Per-instance config-cache TTL in ms (default 60s). */
  configTtlMs?: number
  /** Override fetch (for tests). */
  fetchImpl?: typeof fetch
}

interface CachedConfig {
  etag: string | null
  response: DeploymentConfigResponse
}

export interface VpsClient {
  getDeploymentConfig(deploymentId: string): Promise<DeploymentConfigResponse>
  /**
   * PUBLIC config fetch keyed by the safe `public_deployment_id` (never the internal id).
   * Mirrors `getDeploymentConfig` (same Bearer secret + ETag/304 cache) but hits the
   * public route, whose body also carries `allowedOrigins` for browser CORS.
   */
  getPublicDeploymentConfig(publicId: string): Promise<DeploymentConfigResponse>
  getLlmCredentials(deploymentId: string, model?: string): Promise<LlmCredentials>
  executeTool(
    deploymentId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<ToolExecuteResult>
  retrieveKnowledge(
    deploymentId: string,
    query: string,
    knowledgeIds?: string[],
  ): Promise<KnowledgeResult>
  ingestCall(body: unknown): Promise<void>
  ingestUsage(body: unknown): Promise<void>
}

export function createVpsClient(opts: VpsClientOptions): VpsClient {
  const fetchFn = opts.fetchImpl ?? globalThis.fetch
  if (!fetchFn) throw new Error('No fetch implementation available')
  const base = opts.baseUrl.replace(/\/+$/, '')
  const authHeader = `Bearer ${opts.runtimeSecret}`

  // Per-instance LRU config mirror: fetch-once + revalidate on ETag (304 ⇒ reuse cached body).
  const configCache = new LRUCache<string, CachedConfig>({
    max: 500,
    ttl: opts.configTtlMs ?? 60_000,
  })

  async function getDeploymentConfig(deploymentId: string): Promise<DeploymentConfigResponse> {
    const cached = configCache.get(deploymentId)
    const headers: Record<string, string> = { Authorization: authHeader }
    if (cached?.etag) headers['If-None-Match'] = cached.etag

    const res = await fetchFn(`${base}/api/runtime/deployments/${deploymentId}/config`, { headers })

    if (res.status === 304 && cached) return cached.response
    if (res.status === 401)
      throw new Error('runtime config: unauthorized (check RUNTIME_CONFIG_SECRET)')
    if (res.status === 404)
      throw new Error(
        `runtime config: deployment ${deploymentId} not found or not a published chat_runtime`,
      )
    if (!res.ok) throw new Error(`runtime config: unexpected status ${res.status}`)

    const response = (await res.json()) as DeploymentConfigResponse
    configCache.set(deploymentId, { etag: res.headers.get('etag'), response })
    return response
  }

  // PUBLIC config mirror — separate LRU entry (keyed by public id, NOT the internal id), so
  // the public + internal caches never collide. Same Bearer secret + ETag/304 revalidation.
  const publicConfigCache = new LRUCache<string, CachedConfig>({
    max: 500,
    ttl: opts.configTtlMs ?? 60_000,
  })

  async function getPublicDeploymentConfig(publicId: string): Promise<DeploymentConfigResponse> {
    const cached = publicConfigCache.get(publicId)
    const headers: Record<string, string> = { Authorization: authHeader }
    if (cached?.etag) headers['If-None-Match'] = cached.etag

    const res = await fetchFn(`${base}/api/runtime/public-deployments/${publicId}/config`, {
      headers,
    })

    if (res.status === 304 && cached) return cached.response
    if (res.status === 401)
      throw new Error('runtime config: unauthorized (check RUNTIME_CONFIG_SECRET)')
    if (res.status === 404)
      throw new Error(
        `runtime config: public deployment ${publicId} not found or not a published chat_runtime`,
      )
    if (!res.ok) throw new Error(`runtime config: unexpected status ${res.status}`)

    const response = (await res.json()) as DeploymentConfigResponse
    publicConfigCache.set(publicId, { etag: res.headers.get('etag'), response })
    return response
  }

  // LLM credentials are sensitive — short TTL, small cache (Option A; DECISIONS.md).
  const credsCache = new LRUCache<string, LlmCredentials>({ max: 200, ttl: 5 * 60_000 })

  async function getLlmCredentials(deploymentId: string, model?: string): Promise<LlmCredentials> {
    const cacheKey = `${deploymentId}::${model ?? ''}`
    const cached = credsCache.get(cacheKey)
    if (cached) return cached

    const qs = model ? `?model=${encodeURIComponent(model)}` : ''
    const res = await fetchFn(
      `${base}/api/runtime/deployments/${deploymentId}/llm-credentials${qs}`,
      { headers: { Authorization: authHeader } },
    )
    if (res.status === 401) throw new Error('llm credentials: unauthorized')
    if (res.status === 400) throw new Error('llm credentials: no project key for this model')
    if (!res.ok) throw new Error(`llm credentials: unexpected status ${res.status}`)

    const creds = (await res.json()) as LlmCredentials
    credsCache.set(cacheKey, creds)
    return creds
  }

  async function postJson(path: string, body: unknown): Promise<Response> {
    return fetchFn(`${base}${path}`, {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  async function executeTool(
    deploymentId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<ToolExecuteResult> {
    const res = await postJson(`/api/runtime/deployments/${deploymentId}/tools/execute`, {
      tool_name: toolName,
      arguments: args,
    })
    if (!res.ok) throw new Error(`tool execution failed: ${res.status}`)
    return res.json() as Promise<ToolExecuteResult>
  }

  async function retrieveKnowledge(
    deploymentId: string,
    query: string,
    knowledgeIds?: string[],
  ): Promise<KnowledgeResult> {
    const res = await postJson(`/api/runtime/deployments/${deploymentId}/knowledge/retrieve`, {
      query,
      knowledgeIds,
    })
    if (!res.ok) throw new Error(`knowledge retrieval failed: ${res.status}`)
    return res.json() as Promise<KnowledgeResult>
  }

  // Ingest is at-least-once + idempotent on the VPS side (BL2 / 0B.4 / 0B.5): failures are
  // logged, not thrown, so a transient ingest hiccup never fails the user's chat turn.
  async function ingestCall(body: unknown): Promise<void> {
    try {
      const res = await postJson('/api/v1/calls/ingest', body)
      if (!res.ok) console.error(`[agent-core] calls/ingest ${res.status}`)
    } catch (err) {
      console.error('[agent-core] calls/ingest error', err)
    }
  }

  async function ingestUsage(body: unknown): Promise<void> {
    try {
      const res = await postJson('/api/v1/usage/ingest', body)
      if (!res.ok) console.error(`[agent-core] usage/ingest ${res.status}`)
    } catch (err) {
      console.error('[agent-core] usage/ingest error', err)
    }
  }

  return {
    getDeploymentConfig,
    getPublicDeploymentConfig,
    getLlmCredentials,
    executeTool,
    retrieveKnowledge,
    ingestCall,
    ingestUsage,
  }
}
