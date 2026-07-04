import { serve } from '@hono/node-server';
import { createApp } from './app.js';

/**
 * The serve entrypoint (`pnpm --filter @silo/api dev`/`start`). Loads `.env`
 * via `tsx --env-file-if-exists` (see `package.json`'s scripts — mirrors
 * `@silo/app`'s `main.ts` env-loading story), builds the app from the
 * factory, and hands it to `@hono/node-server`'s `serve` to actually listen.
 * Kept minimal on purpose — all route/error-handling logic lives in
 * `createApp` (`app.ts`), not here.
 *
 * `PORT` defaults to 8787 when unset (see `.env.example`). All diagnostics go
 * to stderr, matching every other adapter entrypoint in this repo (stdout is
 * reserved for protocol/data output on adapters that need it; a plain HTTP
 * server has no such constraint, but stderr-for-logs is kept consistent
 * across `@silo/mcp-server`'s and `@silo/app`'s entrypoints).
 */
const DEFAULT_PORT = 8787;

function readPort(): number {
  const raw = process.env.PORT;
  if (raw === undefined || raw === '') return DEFAULT_PORT;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PORT;
}

const port = readPort();
const app = createApp();

serve({ fetch: app.fetch, port }, (info) => {
  console.error(`[silo/api] listening on :${info.port}`);
});
