import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { configDir } from '../config.js';

/** The seen-set file for `silo ingest x` — `~/.config/silo/ingest-x-seen.json`, one file per ingest plugin (per the plan's platform naming: a future `pocket`/`hn` plugin gets its own `ingest-<platform>-seen.json`, not a shared state file). */
export function seenSetPath(plugin: string): string {
  return join(configDir(), `ingest-${plugin}-seen.json`);
}

/**
 * Reads the seen-set as a `Set<string>` of already-sent bookmark ids,
 * returning an empty set if the file doesn't exist yet (first run) or is
 * malformed (corrupted state must not crash the run — worst case, a
 * corrupted seen-set just means a full re-send, which silo's own
 * URL-based dedup on the server absorbs safely per the plan's "safety net"
 * design; it never means data loss).
 */
export async function readSeenSet(path: string): Promise<Set<string>> {
  try {
    const raw = await readFile(path, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === 'string'));
  } catch {
    return new Set();
  }
}

/** Persists the seen-set, creating the config dir first if needed. */
export async function writeSeenSet(path: string, seen: Set<string>): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify([...seen])}\n`, 'utf8');
}
