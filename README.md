# chat-runtime

Stateless Hono runtime for VPS **website_chat** agents. **Generated** from
`voice-prompt-studio/apps/chat-runtime` (+ vendored `@vps/agent-core`) by
`scripts/sync-chat-runtime-template.mjs` — do not hand-edit; edit the monorepo and re-sync.

Deploy targets:
- **Vercel** (serverless): zero-config; `src/server.ts` is auto-detected, routes served at `/health`, `/chat`.
- **Container** (Railway/Fly/…): `Dockerfile` runs the Node entry `src/index.ts`.

Required env: `VPS_BASE_URL`, `RUNTIME_CONFIG_SECRET`.
