import { runReaderBackfill } from '@silo/core';
import type { PgBoss } from 'pg-boss';
import { invalidateLiveReader } from '../reader/live-reader.js';
import { createReaderRefresher } from '../reader/refresh-reader.js';

export async function registerReaderBackfillJob(boss: PgBoss): Promise<void> {
  const queue = 'reader-backfill';
  await boss.createQueue(queue);
  await boss.schedule(
    queue,
    '*/5 * * * *',
    {},
    {
      tz: 'UTC',
      singletonKey: queue,
      singletonSeconds: 5 * 60,
    },
  );
  await boss.work(queue, { batchSize: 1 }, async ([job]) => {
    try {
      await runReaderBackfill(createReaderRefresher(invalidateLiveReader), job?.signal);
    } catch (error) {
      console.error('[silo/worker] reader-backfill failed:', error);
    }
  });
}
