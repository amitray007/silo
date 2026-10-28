import type { AiProviderKind } from './catalog.js';
import { AI_ERROR_CODES, type AiErrorCode } from './features.js';
import { refreshFireworksModels } from './models.js';
import { readAiProviderKey, recordAiTest } from './providers.js';
import { type AiCredential, resolveWithBlob } from './status.js';

/** Result of a connection test run by the registered tester. */
export type AiConnectionResult =
  | { ok: true; latencyMs: number }
  | { ok: false; code: AiErrorCode; latencyMs: number };

/** What `testAiProvider` returns. `unavailable` means the test could not run (no tester registered, or no readable key). */
export type AiTestOutcome = AiConnectionResult | { ok: false; code: 'unavailable' };

/** Process-local port. Only the composition root registers the worker implementation. */
export type AiConnectionTester = (credential: AiCredential) => Promise<AiConnectionResult>;

let tester: AiConnectionTester | undefined;

export function setAiConnectionTester(next: AiConnectionTester | undefined): void {
  tester = next;
}

/** Rebuilds the tester's answer from known fields only; an unknown code becomes `provider_error`. */
function sanitize(raw: AiConnectionResult, latencyMs: number): AiConnectionResult {
  if (raw.ok === true) return { ok: true, latencyMs };
  const code = (AI_ERROR_CODES as readonly string[]).includes(raw.code)
    ? raw.code
    : 'provider_error';
  return { ok: false, code, latencyMs };
}

/**
 * Tests the stored key for `kind` with the registered tester and records the
 * outcome on the provider row, but only while the row still holds the
 * ciphertext that was tested. A tester that throws counts as `provider_error`.
 * Records nothing when the result is `unavailable`. Works while AI is switched
 * off, so a key can be checked before it is turned on.
 */
export async function testAiProvider(kind: AiProviderKind): Promise<AiTestOutcome> {
  if (!tester) return { ok: false, code: 'unavailable' };
  // Finish the list refresh before invoking the tester, which owns the generation deadline.
  if (kind === 'fireworks') {
    const failure = await refreshForTest();
    if (failure) return failure;
  }
  const resolved = await resolveWithBlob(kind);
  if (!resolved) return { ok: false, code: 'unavailable' };
  const started = Date.now();
  let result: AiConnectionResult;
  try {
    const raw = await tester(resolved.credential);
    result = sanitize(raw, Number.isFinite(raw.latencyMs) ? raw.latencyMs : Date.now() - started);
  } catch {
    result = { ok: false, code: 'provider_error', latencyMs: Date.now() - started };
  }
  await recordAiTest(
    kind,
    result.ok ? { ok: true } : { ok: false, code: result.code },
    resolved.encryptedKey,
  );
  return result;
}

async function refreshForTest(): Promise<AiTestOutcome | undefined> {
  const key = await readAiProviderKey('fireworks');
  if (key.state !== 'ok') return { ok: false, code: 'unavailable' };
  const started = Date.now();
  const refreshed = await refreshFireworksModels();
  if (refreshed.ok) return undefined;
  if (refreshed.code === 'unavailable') return { ok: false, code: 'unavailable' };
  // A refresh failure does not prevent inference with the same key's stored default.
  const stored = await resolveWithBlob('fireworks');
  if (stored?.encryptedKey === key.encryptedKey) return undefined;
  const result = { ok: false, code: refreshed.code, latencyMs: Date.now() - started } as const;
  await recordAiTest('fireworks', result, key.encryptedKey);
  return result;
}
