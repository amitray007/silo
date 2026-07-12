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

    await runIngestX(client, { dryRun: false, json: false, hasToken: true, resend: false });

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

    await runIngestX(client, { dryRun: false, json: true, hasToken: true, resend: false });

    expect(ingest).toHaveBeenCalledTimes(2);
    const summary = JSON.parse(logSpy.mock.calls.at(-1)?.[0] as string);
    expect(summary.created).toBe(2);
    expect(summary.deduped).toBe(0);
    expect(summary.failed).toBe(0);
  });

  it('splits truthful created/deduped counts from the deduped flag (Fix A)', async () => {
    await writeBookmarksFile([bookmarkLine('1'), bookmarkLine('2'), bookmarkLine('3')]);
    const ingest = vi
      .fn()
      .mockResolvedValueOnce({ link: { id: 'x' }, deduped: false } as unknown as CaptureResponse)
      .mockResolvedValueOnce({ link: { id: 'x' }, deduped: true } as unknown as CaptureResponse)
      .mockResolvedValueOnce({ link: { id: 'x' }, deduped: true } as unknown as CaptureResponse);
    const client = { ingest } as unknown as Client;

    await runIngestX(client, { dryRun: false, json: true, hasToken: true, resend: false });

    const summary = JSON.parse(logSpy.mock.calls.at(-1)?.[0] as string);
    expect(summary.created).toBe(1);
    expect(summary.deduped).toBe(2);
    expect(summary.total).toBe(3);
  });

  it('a zero-dedup run prints only the "N new" segment, no "already in silo"', async () => {
    await writeBookmarksFile([bookmarkLine('1')]);
    const ingest = vi
      .fn()
      .mockResolvedValue({ link: { id: 'x' }, deduped: false } as unknown as CaptureResponse);
    const client = { ingest } as unknown as Client;

    await runIngestX(client, { dryRun: false, json: false, hasToken: true, resend: false });

    const printed = logSpy.mock.calls.map((c: unknown[]) => c.join(' ')).join('\n');
    expect(printed).toContain('1 new');
    expect(printed).not.toContain('already in silo');
  });

  it('dedups: a second run only sends bookmarks not already in the seen-set', async () => {
    await writeBookmarksFile([bookmarkLine('1'), bookmarkLine('2')]);
    const ingest = vi
      .fn()
      .mockResolvedValue({ link: { id: 'x' }, deduped: false } as unknown as CaptureResponse);
    const client = { ingest } as unknown as Client;

    await runIngestX(client, { dryRun: false, json: true, hasToken: true, resend: false });
    expect(ingest).toHaveBeenCalledTimes(2);

    ingest.mockClear();
    await writeBookmarksFile([bookmarkLine('1'), bookmarkLine('2'), bookmarkLine('3')]);
    await runIngestX(client, { dryRun: false, json: true, hasToken: true, resend: false });

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

    await runIngestX(client, { dryRun: false, json: true, hasToken: true, resend: false });

    ingest.mockClear();
    ingest.mockResolvedValue({ link: { id: 'x' }, deduped: false } as unknown as CaptureResponse);
    await runIngestX(client, { dryRun: false, json: true, hasToken: true, resend: false });

    // Exactly one bookmark (the one that failed last time) is retried.
    expect(ingest).toHaveBeenCalledTimes(1);
  });

  it('respects --limit, capping how many bookmarks are sent', async () => {
    await writeBookmarksFile([bookmarkLine('1'), bookmarkLine('2'), bookmarkLine('3')]);
    const ingest = vi
      .fn()
      .mockResolvedValue({ link: { id: 'x' }, deduped: false } as unknown as CaptureResponse);
    const client = { ingest } as unknown as Client;

    await runIngestX(client, {
      dryRun: false,
      json: true,
      hasToken: true,
      limit: 2,
      resend: false,
    });

    expect(ingest).toHaveBeenCalledTimes(2);
  });

  it('--dry-run maps and reports without POSTing anything', async () => {
    await writeBookmarksFile([bookmarkLine('1'), bookmarkLine('2')]);
    const ingest = vi.fn();
    const client = { ingest } as unknown as Client;

    await runIngestX(client, { dryRun: true, json: true, hasToken: false, resend: false });

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

    await runIngestX(client, { dryRun: false, json: true, hasToken: true, resend: false });

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

    await runIngestX(client, { dryRun: false, json: true, hasToken: true, resend: false });

    const printed = errorSpy.mock.calls.map((c: unknown[]) => c.join(' ')).join('\n');
    expect(printed).toContain('Set a token.');
  });

  it('reports "nothing new" without calling ingest when everything is already seen', async () => {
    await writeBookmarksFile([bookmarkLine('1')]);
    const ingest = vi
      .fn()
      .mockResolvedValue({ link: { id: 'x' }, deduped: false } as unknown as CaptureResponse);
    const client = { ingest } as unknown as Client;

    await runIngestX(client, { dryRun: false, json: false, hasToken: true, resend: false });
    ingest.mockClear();
    await runIngestX(client, { dryRun: false, json: false, hasToken: true, resend: false });

    expect(ingest).not.toHaveBeenCalled();
  });

  // Regression test for the original bug: a bookmark id sits in the seen-set
  // (e.g. the user soft-deleted the corresponding row server-side, or it was
  // sent in a prior run) — the DEFAULT run must skip it (never re-checks the
  // server), but `--resend` must re-queue and re-send it. This is the test
  // that would have failed before Fix B (no way to override the seen-set)
  // and passes after.
  it('a seen id is skipped by default but re-sent under --resend (heals server-side drift)', async () => {
    await writeBookmarksFile([bookmarkLine('1')]);
    const ingest = vi
      .fn()
      .mockResolvedValue({ link: { id: 'x' }, deduped: false } as unknown as CaptureResponse);
    const client = { ingest } as unknown as Client;

    // First run: bookmark '1' is sent and recorded in the seen-set.
    await runIngestX(client, { dryRun: false, json: false, hasToken: true, resend: false });
    expect(ingest).toHaveBeenCalledTimes(1);
    ingest.mockClear();

    // Imagine the user soft-deleted this row in silo for testing — the
    // seen-set has no way to know that. A default re-run must still skip it.
    await runIngestX(client, { dryRun: false, json: false, hasToken: true, resend: false });
    expect(ingest).not.toHaveBeenCalled();

    // `--resend` is the escape hatch: it bypasses the seen-set and re-sends
    // every mappable bookmark, healing the drift. The server's canonical-url
    // dedup makes this safe even for rows that are still live.
    await runIngestX(client, { dryRun: false, json: false, hasToken: true, resend: true });
    expect(ingest).toHaveBeenCalledTimes(1);
    expect(ingest).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://x.com/a/status/1' }),
    );
  });

  // Locks Fix A's core invariant against a run that hits all three outcomes at
  // once — a miscount that shuffled a failure into `deduped` (or double-counted
  // a merge) would break `created + deduped + failed === total` and fail here,
  // even though each single-bucket test above would still pass.
  it('created + deduped + failed always sums to total (mixed run)', async () => {
    await writeBookmarksFile([bookmarkLine('1'), bookmarkLine('2'), bookmarkLine('3')]);
    const ingest = vi
      .fn()
      .mockResolvedValueOnce({ link: { id: 'x' }, deduped: false } as unknown as CaptureResponse)
      .mockResolvedValueOnce({ link: { id: 'x' }, deduped: true } as unknown as CaptureResponse)
      .mockRejectedValueOnce(new Error('network blip'));
    const client = { ingest } as unknown as Client;

    await runIngestX(client, { dryRun: false, json: true, hasToken: true, resend: false });

    const summary = JSON.parse(logSpy.mock.calls.at(-1)?.[0] as string);
    expect(summary.created).toBe(1);
    expect(summary.deduped).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.created + summary.deduped + summary.failed).toBe(summary.total);
  });

  // A `--resend` run must still PERSIST its successes to the seen-set, so a
  // later DEFAULT run skips them — otherwise `--resend` would silently disable
  // resumability. Proves the seen-set is re-written by the resend, not just
  // that the resend re-sent.
  it('--resend persists its successes so a later default run skips them', async () => {
    await writeBookmarksFile([bookmarkLine('1')]);
    const ingest = vi
      .fn()
      .mockResolvedValue({ link: { id: 'x' }, deduped: false } as unknown as CaptureResponse);
    const client = { ingest } as unknown as Client;

    // Start from an empty seen-set and send via --resend.
    await runIngestX(client, { dryRun: false, json: false, hasToken: true, resend: true });
    expect(ingest).toHaveBeenCalledTimes(1);

    // A subsequent DEFAULT run must now treat it as already sent.
    ingest.mockClear();
    await runIngestX(client, { dryRun: false, json: false, hasToken: true, resend: false });
    expect(ingest).not.toHaveBeenCalled();
  });
});
