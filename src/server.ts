/**
 * Vercel entry — zero-config default export (Part A).
 *
 * Vercel auto-detects this file (`src/server.ts` is one of the six probed backend locations)
 * and serves the Hono app's routes at their declared ROOT paths (`/health`, `/chat`) on Fluid
 * Compute. No `api/` directory, no `hono/vercel` adapter, no rewrites — those are the legacy
 * path and would force a `/api` prefix.
 *
 * Local/Node dev keeps using `src/index.ts` (`@hono/node-server`); serverless uses this file.
 */
import { createAppFromEnv } from './app'
import { loadEnv } from './config'

// Constructed once at module load → warm-reused across requests on Fluid Compute.
// loadEnv() throws a clear, logged message if VPS_BASE_URL / RUNTIME_CONFIG_SECRET are missing,
// so a misconfigured cold start is diagnosable in Vercel Runtime Logs.
const app = createAppFromEnv(loadEnv())

export default app
