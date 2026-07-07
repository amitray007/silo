import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readSeenSet, seenSetPath, writeSeenSet } from './state.js';

describe('seenSetPath', () => {
  const originalXdg = process.env.XDG_CONFIG_HOME;

  afterEach(() => {
    if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalXdg;
  });

  it('is namespaced per ingest plugin', () => {
    process.env.XDG_CONFIG_HOME = '/custom';
    expect(seenSetPath('x')).toBe('/custom/silo/ingest-x-seen.json');
    expect(seenSetPath('pocket')).toBe('/custom/silo/ingest-pocket-seen.json');
  });
});

describe('readSeenSet / writeSeenSet', () => {
  let dir: string;
  let path: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'silo-cli-seen-'));
    path = join(dir, 'ingest-x-seen.json');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns an empty set when the file does not exist yet (first run)', async () => {
    expect(await readSeenSet(path)).toEqual(new Set());
  });

  it('round-trips a written seen-set', async () => {
    await writeSeenSet(path, new Set(['a', 'b', 'c']));
    expect(await readSeenSet(path)).toEqual(new Set(['a', 'b', 'c']));
  });

  it('creates the parent directory if it does not exist', async () => {
    const nestedPath = join(dir, 'nested', 'ingest-x-seen.json');
    await writeSeenSet(nestedPath, new Set(['x']));
    expect(await readSeenSet(nestedPath)).toEqual(new Set(['x']));
  });

  it('returns an empty set for a malformed seen-set file rather than throwing', async () => {
    await writeFile(path, 'not json{{{', 'utf8');
    expect(await readSeenSet(path)).toEqual(new Set());
  });

  it('returns an empty set when the file holds something other than a JSON array', async () => {
    await writeFile(path, JSON.stringify({ not: 'an array' }), 'utf8');
    expect(await readSeenSet(path)).toEqual(new Set());
  });

  it('filters out non-string entries from a hand-edited file', async () => {
    await writeFile(path, JSON.stringify(['a', 42, null, 'b']), 'utf8');
    expect(await readSeenSet(path)).toEqual(new Set(['a', 'b']));
  });
});
