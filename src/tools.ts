/**
 * Build AI SDK tools from the snapshot's RuntimeToolDefs (Track 7 C-4). Each tool's `execute`
 * proxies to VPS via the runtime tools/execute endpoint (the 3-layer `executeTool`, structured
 * args). The model calls them interactively as the in-prompt flow reaches the step they're
 * bound to — no server-side flow engine / auto-execute.
 */

import { tool, jsonSchema, type ToolSet } from 'ai'
import type { RuntimeToolDef, VpsClient } from './agent-core/index.js'

export function buildTools(deploymentId: string, defs: RuntimeToolDef[], vps: VpsClient): ToolSet {
  const entries = defs.map((def) => {
    return [
      def.name,
      tool({
        description: def.description,
        // def.parameters is a valid JSON Schema at runtime; its type is loosely
        // Record<string, unknown>, so cast at this boundary.
        inputSchema: jsonSchema(def.parameters as Parameters<typeof jsonSchema>[0]),
        execute: async (args: unknown) => {
          const r = await vps.executeTool(
            deploymentId,
            def.name,
            (args ?? {}) as Record<string, unknown>,
          )
          // Hand the model a useful payload either way (success result or a structured error).
          return r.success ? (r.result ?? { ok: true }) : { error: r.error ?? 'tool failed' }
        },
      }),
    ] as const
  })
  return Object.fromEntries(entries) as ToolSet
}
