import type { PgBoss } from 'pg-boss';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('@silo/core', () => ({ listDueFeeds: vi.fn(), pollFeed: vi.fn() }));
vi.mock('../feeds/resolve.js', () => ({ fetchFeedPoll: vi.fn() }));

import { listDueFeeds, pollFeed } from '@silo/core';
import { registerFeedJobs } from './poll-feeds.js';

afterEach(() => vi.restoreAllMocks());
it('logs send failures and keeps queueing the other due feeds', async () => {
  const handlers = new Map<string, (jobs?: unknown) => Promise<void>>();
  const send = vi.fn().mockRejectedValueOnce(new Error('queue down')).mockResolvedValue('ok');
  const boss = {
    createQueue: vi.fn(),
    schedule: vi.fn(),
    send,
    work: vi.fn(async (name: string, ...args: unknown[]) => {
      handlers.set(name, args.at(-1) as (jobs?: unknown) => Promise<void>);
    }),
  } as unknown as PgBoss;
  vi.mocked(listDueFeeds).mockResolvedValue(['first', 'second']);
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  await registerFeedJobs(boss);
  await handlers.get('poll-feeds-due')?.();
  expect(send).toHaveBeenCalledTimes(2);
  expect(send).toHaveBeenLastCalledWith(
    'poll-feed',
    { feedId: 'second' },
    { singletonKey: 'second' },
  );
  expect(log).toHaveBeenCalledWith(expect.stringContaining('poll-feeds-due'), expect.any(Error));
  vi.mocked(pollFeed).mockRejectedValueOnce(new Error('database down'));
  await handlers.get('poll-feed')?.([{ data: { feedId: 'first' } }]);
  expect(log).toHaveBeenCalledWith(expect.stringContaining('poll-feed:'), expect.any(Error));
  vi.mocked(listDueFeeds).mockRejectedValueOnce(new Error('database down'));
  await handlers.get('poll-feeds-due')?.();
  expect(log).toHaveBeenCalledWith(expect.stringContaining('poll-feeds-due'), expect.any(Error));
});
