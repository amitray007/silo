import { listDueFeeds, pollFeed } from '@silo/core';
import type { PgBoss } from 'pg-boss';
import { fetchFeedPoll } from '../feeds/resolve.js';

export async function registerFeedJobs(boss: PgBoss): Promise<void> {
  await boss.createQueue('poll-feed', { policy: 'stately' });
  await boss.createQueue('poll-feeds-due');
  await boss.schedule(
    'poll-feeds-due',
    '*/5 * * * *',
    {},
    { tz: 'UTC', singletonKey: 'poll-feeds-due', singletonSeconds: 240 },
  );
  await boss.work('poll-feeds-due', async () => {
    try {
      for (const feedId of await listDueFeeds()) {
        try {
          await boss.send('poll-feed', { feedId }, { singletonKey: feedId });
        } catch (error) {
          console.error('[silo/worker] poll-feeds-due: enqueue failed:', error);
        }
      }
    } catch (error) {
      console.error('[silo/worker] poll-feeds-due: job failed (will retry next cron tick):', error);
    }
  });
  await boss.work<{ feedId: string }>('poll-feed', { batchSize: 1 }, async (jobs) => {
    for (const job of jobs) {
      try {
        await pollFeed(job.data.feedId, fetchFeedPoll);
      } catch (error) {
        console.error('[silo/worker] poll-feed: job failed (will retry next cron tick):', error);
      }
    }
  });
}
