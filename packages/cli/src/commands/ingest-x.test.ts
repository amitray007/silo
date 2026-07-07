import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Client, ClientError } from '../client.js';
import type { CaptureResponse } from '../types.js';
import { runIngestX } from './ingest-x.js';

function bookmarkLine(id: string, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id,
    url: `https://x.com/a/status/${id}`,
    text: `bookmark ${id}`,
    authorHandle: 'a',
    authorName: 'A',
    engagement: { likeCount: 1, repostCount: 0, replyCount: 0, quoteCount: 0, bookmarkCount: 0 },
    ...overrides,
  });
}

describe('runIngestX', () => {
  let ftDir: string;
  let configDir: string;
  const originalFtDataDir = process.env.FT_DATA_DIR;
  const originalXdg = process.env.XDG_CONFIG_HOME;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    ftDir = await mkdtemp(join(tmpdir(), 'silo-cli-ft-'));
    configDir = await mkdtemp(join(tmpdir(), 'silo-cli-ingest-config-'));
    process.env.FT_DATA_DIR = ftDir;
    process.env.XDG_CONFIG_HOME = configDir;
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(async () => {
    if (originalFtDataDir === undefined) delete process.env.FT_DATA_DIR;
    else process.env.FT_DATA_DIR = originalFtDataDir;
    if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalXdg;
    await rm(ftDir, { recursive: true, force: true });
    await rm(configDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  async function writeBookmarksFile(lines: string[]): Promise<void> {
    const dir = join(ftDir, 'bookmarks');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'bookmarks.jsonl'), lines.join('\n'), 'utf8');
  }

  it('prints a clear "run ft sync first" message when the FT file is missing, without throwing', async () => {
    const client = { ingest: vi.fn() } as unknown as Client;

    await runIngestX(client, { dryRun: false, json: false, hasToken: true });

    expect(client.ingest).not.toHaveBeenCalled();
    const printed = errorSpy.mock.calls.map((c: unknown[]) => c.join(' ')).join('\n');
    expect(printed).toContain('run `ft sync` first');
  });

  it('sends new bookmarks and marks them seen', async () => {
    await writeBookmarksFile([bookmarkLine('1'), bookmarkLine('2')]);
    const ingest = vi
      .fn()
      .mockResolvedValue({ link: { id: 'x' }, deduped: false } as unknown as CaptureResponse);
    const client = { ingest } as unknown as Client;

    await runIngestX(client, { dryRun: false, json: true, hasToken: true });

    expect(ingest).toHaveBeenCalledTimes(2);
    const summary = JSON.parse(logSpy.mock.calls.at(-1)?.[0] as string);
    expect(summary.sent).toBe(2);
    expect(summary.failed).toBe(0);
  });

  it('dedups: a second run only sends bookmarks not already in the seen-set', async () => {
    await writeBookmarksFile([bookmarkLine('1'), bookmarkLine('2')]);
    const ingest = vi
      .fn()
      .mockResolvedValue({ link: { id: 'x' }, deduped: false } as unknown as CaptureResponse);
    const client = { ingest } as unknown as Client;

    await runIngestX(client, { dryRun: false, json: true, hasToken: true });
    expect(ingest).toHaveBeenCalledTimes(2);

    ingest.mockClear();
    await writeBookmarksFile([bookmarkLine('1'), bookmarkLine('2'), bookmarkLine('3')]);
    await runIngestX(client, { dryRun: false, json: true, hasToken: true });

    expect(ingest).toHaveBeenCalledTimes(1);
    expect(ingest).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://x.com/a/status/3' }),
    );
  });

  it('a killed/partially-failed run only marks SUCCEEDED bookmarks as seen (resumable)', async () => {
    await writeBookmarksFile([bookmarkLine('1'), bookmarkLine('2')]);
    const ingest = vi
      .fn()
      .mockImplementationOnce(() =>
        Promise.resolve({ link: { id: 'x' }, deduped: false } as unknown as CaptureResponse),
      )
      .mockImplementationOnce(() => Promise.reject(new Error('network blip')));
    const client = { ingest } as unknown as Client;

    await runIngestX(client, { dryRun: false, json: true, hasToken: true });

    ingest.mockClear();
    ingest.mockResolvedValue({ link: { id: 'x' }, deduped: false } as unknown as CaptureResponse);
    await runIngestX(client, { dryRun: false, json: true, hasToken: true });

    // Exactly one bookmark (the one that failed last time) is retried.
    expect(ingest).toHaveBeenCalledTimes(1);
  });

  it('respects --limit, capping how many bookmarks are sent', async () => {
    await writeBookmarksFile([bookmarkLine('1'), bookmarkLine('2'), bookmarkLine('3')]);
    const ingest = vi
      .fn()
      .mockResolvedValue({ link: { id: 'x' }, deduped: false } as unknown as CaptureResponse);
    const client = { ingest } as unknown as Client;

    await runIngestX(client, { dryRun: false, json: true, hasToken: true, limit: 2 });

    expect(ingest).toHaveBeenCalledTimes(2);
  });

  it('--dry-run maps and reports without POSTing anything', async () => {
    await writeBookmarksFile([bookmarkLine('1'), bookmarkLine('2')]);
    const ingest = vi.fn();
    const client = { ingest } as unknown as Client;

    await runIngestX(client, { dryRun: true, json: true, hasToken: false });

    expect(ingest).not.toHaveBeenCalled();
    const report = JSON.parse(logSpy.mock.calls.at(-1)?.[0] as string);
    expect(report.dryRun).toBe(true);
    expect(report.wouldSend).toBe(2);
  });

  it('skips a bookmark that fails to map (missing required field) rather than crashing the run', async () => {
    await writeBookmarksFile([bookmarkLine('1'), bookmarkLine('2', { text: '' })]);
    const ingest = vi
      .fn()
      .mockResolvedValue({ link: { id: 'x' }, deduped: false } as unknown as CaptureResponse);
    const client = { ingest } as unknown as Client;

    await runIngestX(client, { dryRun: false, json: true, hasToken: true });

    expect(ingest).toHaveBeenCalledTimes(1);
    const summary = JSON.parse(logSpy.mock.calls.at(-1)?.[0] as string);
    expect(summary.skippedUnmappable).toBe(1);
  });

  it('a 401 mid-run prints an actionable stop message rather than a raw error', async () => {
    await writeBookmarksFile([bookmarkLine('1')]);
    const ingest = vi
      .fn()
      .mockRejectedValue(new ClientError(401, 'unauthorized', 'nope', 'Set a token.'));
    const client = { ingest } as unknown as Client;

    await runIngestX(client, { dryRun: false, json: true, hasToken: true });

    const printed = errorSpy.mock.calls.map((c: unknown[]) => c.join(' ')).join('\n');
    expect(printed).toContain('Set a token.');
  });

  it('reports "nothing new" without calling ingest when everything is already seen', async () => {
    await writeBookmarksFile([bookmarkLine('1')]);
    const ingest = vi
      .fn()
      .mockResolvedValue({ link: { id: 'x' }, deduped: false } as unknown as CaptureResponse);
    const client = { ingest } as unknown as Client;

    await runIngestX(client, { dryRun: false, json: false, hasToken: true });
    ingest.mockClear();
    await runIngestX(client, { dryRun: false, json: false, hasToken: true });

    expect(ingest).not.toHaveBeenCalled();
  });
});
