/**
 * Node entry for the website-chat runtime (local dev + a Node/Railway server). Serverless
 * targets (Vercel/CF) wrap the same `createApp`/`createAppFromEnv` via their own adapter and
 * do not use this file.
 */

import { serve } from '@hono/node-server'
import { loadEnv } from './config.js'
import { createAppFromEnv } from './app.js'

const env = loadEnv()
const app = createAppFromEnv(env)

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`[chat-runtime] listening on :${info.port}`)
})
