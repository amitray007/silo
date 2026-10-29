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
    for (const feedId of await listDueFeeds()) {
      await boss.send('poll-feed', { feedId }, { singletonKey: feedId });
    }
  });
  await boss.work<{ feedId: string }>('poll-feed', { batchSize: 1 }, async (jobs) => {
    for (const job of jobs) await pollFeed(job.data.feedId, fetchFeedPoll);
  });
}
