import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

/**
 * Shared harness for integration tests that need a real, disposable Postgres
 * database (generated columns, partial-unique constraints, and full-text
 * ranking are database behaviors mocks can't prove — see
 * docs/rules/testing.md). Each test file gets its own database name; call
 * `create()` in `beforeAll` and `drop()` in `afterAll`.
 */

const ADMIN_URL = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/postgres';

function adminExec(statement: string): void {
  execFileSync('psql', [ADMIN_URL, '-v', 'ON_ERROR_STOP=1', '-c', statement], {
    stdio: 'pipe',
  });
}

/**
 * True if a local/CI Postgres is reachable — gates the `describe.skip`
 * fallback so integration suites are silently skipped when no DB is present
 * (e.g. a local dev box without Postgres).
 *
 * `CI_REQUIRE_DB`: when set (in CI), an unreachable DB THROWS instead of
 * returning false. Otherwise a misconfigured service URL would make every
 * integration suite skip and the build go green with zero integration
 * coverage — the exact failure this guard prevents.
 */
export function postgresReachable(): boolean {
  try {
    adminExec('SELECT 1');
    return true;
  } catch (error) {
    // Explicit truthy values only — `CI_REQUIRE_DB=false`/`0` must NOT require
    // the DB (a plain truthy check would treat any non-empty string as on).
    const requireDb = process.env.CI_REQUIRE_DB === '1' || process.env.CI_REQUIRE_DB === 'true';
    if (requireDb) {
      throw new Error(
        `CI_REQUIRE_DB is set but Postgres at ${ADMIN_URL} is unreachable — refusing to skip integration tests. Cause: ${String(error)}`,
      );
    }
    return false;
  }
}

export interface DisposableDatabase {
  /** Connection URL for the freshly created database. */
  url: string;
  /** Drops the database (WITH FORCE, disconnecting any open sessions). */
  drop: () => void;
}

/** Rewrite only the DB name (pathname) of a connection URL, preserving query
 * params like `?sslmode=require` — a naive `.replace(/\/[^/]*$/, ...)` would
 * swallow the query string and silently drop SSL on a managed Postgres. */
function withDatabaseName(connectionUrl: string, dbName: string): string {
  const parsed = new URL(connectionUrl);
  parsed.pathname = `/${dbName}`;
  return parsed.toString();
}

/**
 * Creates a fresh, uniquely-named database, dropping any stale database of the
 * same name first (in case a prior run crashed before cleanup). The name
 * carries a random suffix so it is unique regardless of the prefix or pid —
 * two suites can't collide and drop each other's database mid-run.
 */
export function createDisposableDatabase(namePrefix: string): DisposableDatabase {
  const dbName = `${namePrefix}_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  // WITH (FORCE) on the initial drop too: the crash-before-cleanup case this
  // guards against is exactly when a lingering session from the crashed run
  // holds the stale database, which a plain DROP can't remove.
  adminExec(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  adminExec(`CREATE DATABASE ${dbName}`);

  return {
    url: withDatabaseName(ADMIN_URL, dbName),
    drop: () => {
      adminExec(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    },
  };
}
