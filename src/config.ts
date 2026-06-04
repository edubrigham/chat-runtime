/** Runtime environment configuration (fail fast on missing required vars). */

export interface RuntimeEnv {
  /** VPS base URL the runtime calls (config, credentials, tools, knowledge, ingest). */
  vpsBaseUrl: string
  /** Per-runtime secret (Bearer) for all VPS calls. */
  runtimeSecret: string
  /** Port for the local/Node server (ignored by serverless adapters). */
  port: number
}

export function loadEnv(env: NodeJS.ProcessEnv = process.env): RuntimeEnv {
  const vpsBaseUrl = env.VPS_BASE_URL?.trim()
  const runtimeSecret = env.RUNTIME_CONFIG_SECRET?.trim()
  const missing: string[] = []
  if (!vpsBaseUrl) missing.push('VPS_BASE_URL')
  if (!runtimeSecret) missing.push('RUNTIME_CONFIG_SECRET')
  if (missing.length) {
    throw new Error(`[chat-runtime] missing required env: ${missing.join(', ')}`)
  }
  return {
    vpsBaseUrl: vpsBaseUrl!,
    runtimeSecret: runtimeSecret!,
    port: Number(env.PORT) || 8080,
  }
}
