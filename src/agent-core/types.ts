/**
 * Runtime config types — a standalone copy of the pinned `config_snapshot` shape that the
 * VPS runtime endpoint (`GET /api/runtime/deployments/[id]/config`) returns. Kept here (not
 * imported from the web app) so this package is dependency-free and HTTP-only. The web app's
 * compiler (`src/lib/channels/compile.ts`) is the source of truth for the shape; these must
 * stay structurally compatible.
 */

export type CanonicalChannel = 'website_voice' | 'twilio_voice' | 'website_chat' | 'twilio_whatsapp'

export type RuntimeTarget = 'voice_engine' | 'chat_runtime'
export type DeploymentEnvironment = 'staging' | 'production'

export interface RuntimeToolDef {
  type: 'function'
  id: string
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
  hasSource: boolean
  liveEnabled: boolean
  useWhen?: string[]
  doNotUseWhen?: string[]
  preamblePhrases?: string[]
  isSystemWide?: boolean
}

export interface RuntimeFlowUnit {
  id: string
  description: string
  instructions: string[]
  examples: string[]
  transitions: { next_step: string; condition: string; auto?: boolean }[]
  tools?: string[]
  isTerminal?: boolean
}

export interface TextSessionConfig {
  kind: 'text'
  model: string
  streaming: boolean
  maxResponseTokens: number
}

export interface WhatsappSessionConfig {
  kind: 'whatsapp'
  model: string
  streaming: false
  sessionTimeoutMs: number
  messagingServiceSid: string | null
}

export interface VoiceSessionConfig {
  kind: 'voice'
  settings: Record<string, unknown> | null
}

export type ChannelSessionConfig = TextSessionConfig | WhatsappSessionConfig | VoiceSessionConfig

/** The channel-neutral Agent Core runtime payload (channel-filtered sections already applied). */
export interface AgentCoreRuntime {
  constantPrompt: string
  systemInstructions: string
  flowUnits: Record<string, RuntimeFlowUnit>
  entryFlow: string | null
  hasKnowledge: boolean
  boundKnowledgeIds: string[]
  tools: RuntimeToolDef[]
  missingTools: string[]
  currentVersionNumber: number | null
}

/** The pinned snapshot (`channel_deployments.config_snapshot`). */
export interface ChannelRuntimeConfig {
  channel: CanonicalChannel
  runtimeTarget: RuntimeTarget
  environment: DeploymentEnvironment
  compiledConfigVersion: number
  agentCore: AgentCoreRuntime
  session: ChannelSessionConfig
}

/** Per-project LLM credentials returned by `…/llm-credentials` (Option A). */
export interface LlmCredentials {
  model: string
  apiKey?: string
  azure?: Record<string, unknown> | null
}

/** Result of a runtime tool execution (`…/tools/execute`). */
export interface ToolExecuteResult {
  success: boolean
  result?: unknown
  error?: string
}

/** Result of a runtime knowledge retrieval (`…/knowledge/retrieve`). */
export interface KnowledgeResult {
  context: string
  sources?: unknown
  documentCount?: number
}

/** Envelope returned by `GET /api/runtime/deployments/[id]/config`. */
export interface DeploymentConfigResponse {
  deploymentId: string
  /** Owning agent — needed for durable ingest. */
  agentId: string
  /** Owning project — needed for tools/knowledge calls. */
  projectId: string
  channel: CanonicalChannel
  runtimeTarget: RuntimeTarget
  compiledConfigVersion: number
  config: ChannelRuntimeConfig
  /**
   * Browser-widget origin allowlist. Only the PUBLIC config endpoint
   * (`/api/runtime/public-deployments/[publicId]/config`) sets this; the internal
   * `/api/runtime/deployments/[id]/config` route omits it.
   */
  allowedOrigins?: string[]
}
