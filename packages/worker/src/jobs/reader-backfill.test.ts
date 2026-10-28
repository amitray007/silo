import { runReaderBackfill } from '@silo/core';
import type { Job, PgBoss } from 'pg-boss';
import { describe, expect, it, vi } from 'vitest';
import { registerReaderBackfillJob } from './reader-backfill.js';

vi.mock('@silo/core', () => ({ runReaderBackfill: vi.fn() }));
vi.mock('../reader/live-reader.js', () => ({ invalidateLiveReader: vi.fn() }));
vi.mock('../reader/refresh-reader.js', () => ({ createReaderRefresher: () => 'refresher' }));

describe('reader-backfill cancellation wiring', () => {
  it('passes the pg-boss job signal to the backfill runner', async () => {
    const work = vi.fn();
    const boss = { createQueue: vi.fn(), schedule: vi.fn(), work } as unknown as PgBoss;
    await registerReaderBackfillJob(boss);
    const handler = work.mock.calls[0]?.[2] as (jobs: Pick<Job, 'signal'>[]) => Promise<void>;
    const controller = new AbortController();
    await handler([{ signal: controller.signal }]);
    expect(runReaderBackfill).toHaveBeenCalledWith('refresher', controller.signal);
  });
});
