/**
 * @vps/agent-core — shared, HTTP-only runtime client for VPS channel runtimes.
 *
 * Consumed by `apps/chat-runtime` (and, later, other runtimes). HTTP-only: this package
 * never imports `@supabase/*` or touches the DB; all VPS access goes through HTTP endpoints
 * (BL3 / decision D5). Source-only TS package (no build step) — consumers compile it.
 */

export const AGENT_CORE_VERSION = '0.0.0'

export * from './types'
export { createVpsClient, type VpsClient, type VpsClientOptions } from './client'
