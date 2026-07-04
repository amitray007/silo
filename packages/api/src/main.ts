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
 *
 * SECURITY — bind to LOOPBACK (`127.0.0.1`) by default. The API has NO auth
 * (v1 is single-user/localhost, see `api-hono.md`), so it MUST NOT be reachable
 * off-host by default — otherwise anyone on the LAN could read/write/delete the
 * whole store. Binding to all interfaces requires an explicit `HOST` opt-in AND
 * emits a loud stderr warning, so "exposed + unauthenticated" can never happen
 * silently.
 */
const DEFAULT_PORT = 8787;
const LOOPBACK_HOST = '127.0.0.1';

function readPort(): number {
  const raw = process.env.PORT;
  if (raw === undefined || raw === '') return DEFAULT_PORT;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PORT;
}

/** The bind address. Loopback unless `HOST` is explicitly set (opt-in exposure). */
function readHost(): string {
  const raw = process.env.HOST;
  return raw !== undefined && raw !== '' ? raw : LOOPBACK_HOST;
}

const port = readPort();
const hostname = readHost();
const app = createApp();

if (hostname !== LOOPBACK_HOST) {
  console.error(
    `[silo/api] WARNING: bound to ${hostname} (not loopback). The API has NO ` +
      'authentication — it is now reachable off-host and anyone who can reach ' +
      'it can read, modify, and permanently delete your entire store. Only do ' +
      'this on a trusted, isolated network.',
  );
}

serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.error(`[silo/api] listening on ${info.address}:${info.port}`);
});
