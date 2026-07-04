import { InvalidCursorError } from '@silo/core';
import { Hono } from 'hono';
import { ZodError } from 'zod';

/**
 * The API's error envelope — every non-2xx JSON body this API returns has
 * this shape. `error` is a short machine-stable code (`'invalid_cursor'`,
 * `'validation_error'`, `'not_found'`, `'internal_error'`, ...); `message` is
 * a human-readable summary; `details` is optional, structured extra context
 * (e.g. a Zod issue list) — present only when there's something useful to
 * attach. Documented here as the canonical description; `docs/rules/
 * api-hono.md` restates it for readers who start there instead.
 */
export type ErrorEnvelope = {
  error: string;
  message: string;
  details?: unknown;
};

function errorBody(error: string, message: string, details?: unknown): ErrorEnvelope {
  return details === undefined ? { error, message } : { error, message, details };
}

/**
 * Builds the silo HTTP API. Routes are registered here (A1 registers none —
 * `GET /health` and `GET /` only; A2–A4 add `/api/links`, `/api/trash`,
 * `/api/tags`, `/api/counts`, and the write/lifecycle routes on top of this
 * same factory). Each route is a thin translation over an `@silo/core`
 * function (`docs/rules/architecture.md`: adapters do `HTTP request ↔ core
 * call ↔ HTTP response`, never business logic).
 *
 * Returned UNSTARTED (no listening socket) — mirrors `@silo/mcp-server`'s
 * `createSiloMcpServer()`/`main.ts` split (see its doc comment): tests drive
 * this via Hono's built-in `app.request(...)` with no port needed, and only
 * `main.ts` owns turning it into a real listening process.
 */
export function createApp(): Hono {
  const app = new Hono();

  app.get('/', (c) =>
    c.json({
      name: 'silo',
      description: 'Agent-native personal link store — HTTP API',
      version: '0.0.0',
    }),
  );

  app.get('/health', (c) => c.json({ ok: true }));

  app.notFound((c) => c.json(errorBody('not_found', 'Not found'), 404));

  app.onError((error, c) => {
    if (error instanceof InvalidCursorError) {
      return c.json(errorBody('invalid_cursor', error.message), 400);
    }
    if (error instanceof ZodError) {
      return c.json(errorBody('validation_error', 'Request validation failed', error.issues), 400);
    }
    // Unknown error: never leak internals (stack trace, DB error text) to the
    // client — log the real error to stderr for the operator, return a
    // sanitized, generic body.
    console.error('[silo/api] unhandled error:', error);
    return c.json(errorBody('internal_error', 'Internal server error'), 500);
  });

  return app;
}
