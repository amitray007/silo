import { timingSafeEqual as nodeTimingSafeEqual } from 'node:crypto';

/** Reads `envVar` fresh from the environment on every call (not cached at
 * module load) — so a test that sets/unsets `process.env` between cases
 * observes the change without a module reload, and an operator setting it
 * via a process manager after boot doesn't need the module reimported
 * either. Treats unset OR an empty string as "no token" (returns
 * `undefined`); does NOT trim — a token is an operator-chosen exact secret,
 * and both gates that read it (`ingest-auth.ts`, `general-auth.ts`) call
 * this identical function, so their "empty = unset" semantics stay in
 * lockstep regardless. */
export function readTokenEnv(envVar: string): string | undefined {
  const raw = process.env[envVar];
  return raw !== undefined && raw.length > 0 ? raw : undefined;
}

/** Constant-time string comparison — a bearer token is a secret credential,
 * so comparing it must not leak timing information about how many leading
 * bytes matched (a naive `===` short-circuits on the first mismatched byte).
 * Delegates to Node's audited `crypto.timingSafeEqual` (ce-security review
 * SEC-1 on plan 020: prefer the hardened primitive over a hand-rolled XOR
 * loop, which is a known footgun class — a JIT could in principle
 * reintroduce data-dependent branching a vetted primitive avoids).
 * `timingSafeEqual` THROWS on a length mismatch rather than returning false,
 * so we guard the length first: that early return leaks only the token's
 * LENGTH (not its content), the same accepted/standard tradeoff Node's own
 * docs describe. */
export function timingSafeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return nodeTimingSafeEqual(aBuf, bBuf);
}
