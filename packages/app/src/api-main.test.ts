import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * `./api-main.js` statically imports `@silo/api` (for `createApp`), whose
 * barrel now transitively pulls the OAuth routes -> `@silo/core` -> `@silo/db`,
 * whose client throws at MODULE-LOAD time if `DATABASE_URL` is unset. That load
 * chain fires the moment this file imports ANYTHING from `./api-main.js` — so
 * even the pure `readHost`/`readPort` helpers must be loaded AFTER the env is
 * set. `createApp()`/`readHost`/`readPort` never connect, so we point
 * `DATABASE_URL` at a syntactically valid placeholder and dynamically import
 * both modules AFTER — same load-order discipline as `mcp-http.test.ts`, minus
 * the real DB (this suite makes no queries).
 */
let createApp: typeof import('@silo/api').createApp;
let readHost: typeof import('./api-main.js').readHost;
let readPort: typeof import('./api-main.js').readPort;

beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgres://placeholder:placeholder@127.0.0.1:5432/placeholder';
  ({ createApp } = await import('@silo/api'));
  ({ readHost, readPort } = await import('./api-main.js'));
});

/**
 * Tests for `api-main.ts`'s pure env-parsing helpers (deployable-silo design,
 * Unit 2) plus a light "does this actually compose" check on `createApp()`.
 * Deliberately does NOT boot a real listener or start a real worker — `main()`
 * itself is process wiring (binds a port, starts `@silo/worker`'s pg-boss)
 * that isn't practical or valuable to integration-test here; the turnkey loop
 * (worker + capture + enrich, one process) is already proven end-to-end by
 * `turnkey.test.ts`, and `packages/api`'s own `app.test.ts` already proves
 * `createApp()`'s route behavior. This file only covers what's NEW here: the
 * port/host reading this entrypoint duplicates from `packages/api/src/
 * main.ts` (not importable — that file has no exports), so it's re-tested
 * locally to keep the mirrored logic honest.
 */
describe('readPort', () => {
  const originalPort = process.env.PORT;

  beforeEach(() => {
    delete process.env.PORT;
  });

  afterEach(() => {
    if (originalPort === undefined) {
      delete process.env.PORT;
    } else {
      process.env.PORT = originalPort;
    }
  });

  it('defaults to 8787 when PORT is unset', () => {
    expect(readPort()).toBe(8787);
  });

  it('defaults to 8787 when PORT is an empty string', () => {
    process.env.PORT = '';
    expect(readPort()).toBe(8787);
  });

  it('uses PORT when set to a valid positive number', () => {
    process.env.PORT = '3000';
    expect(readPort()).toBe(3000);
  });

  it.each(['0', '-1', 'not-a-number'])(
    'falls back to the default for an invalid PORT (%s)',
    (raw) => {
      process.env.PORT = raw;
      expect(readPort()).toBe(8787);
    },
  );
});

describe('readHost', () => {
  const originalHost = process.env.HOST;

  beforeEach(() => {
    delete process.env.HOST;
  });

  afterEach(() => {
    if (originalHost === undefined) {
      delete process.env.HOST;
    } else {
      process.env.HOST = originalHost;
    }
  });

  it('defaults to 127.0.0.1 (loopback) when HOST is unset', () => {
    expect(readHost()).toBe('127.0.0.1');
  });

  it('defaults to 127.0.0.1 when HOST is an empty string', () => {
    process.env.HOST = '';
    expect(readHost()).toBe('127.0.0.1');
  });

  it('honors an explicit HOST (the container sets 0.0.0.0)', () => {
    process.env.HOST = '0.0.0.0';
    expect(readHost()).toBe('0.0.0.0');
  });
});

describe('createApp composition', () => {
  it('composes without throwing, from the same import this entrypoint uses', () => {
    expect(() => createApp()).not.toThrow();
  });
});
