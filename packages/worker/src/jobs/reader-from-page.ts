import {
  cleanupPageSnapshots,
  deletePageSnapshot,
  fillPageMetadata,
  getPageSnapshot,
  recordReader,
} from '@silo/core';
import {
  CLEANUP_PAGE_SNAPSHOTS_QUEUE,
  ensureReaderFromPageQueue,
  READER_FROM_PAGE_QUEUE,
} from '@silo/queue';
import type { PgBoss } from 'pg-boss';
import { z } from 'zod';
import { extract } from '../extract/extract.js';

export async function readerFromPage(id: string): Promise<void> {
  const page = await getPageSnapshot(id);
  if (!page) return;
  if (page.readerUploadAt && +page.readerUploadAt >= +page.capturedAt) {
    await deletePageSnapshot(id, page.capturedAt);
    return;
  }
  const result = await extract({ url: page.url, html: page.html, contentType: 'text/html' }).catch(
    () => {
      throw new Error('Browser page extraction failed');
    },
  );
  if (result.readerFailed && result.access !== 'blocked') {
    throw new Error('Browser page extraction failed');
  }
  if (result.reader && !result.readerFailed && result.access !== 'blocked') {
    const processedAt = new Date();
    const written = await recordReader(
      id,
      {
        status: 'reader',
        reader: result.reader,
        readerSource: 'extension',
        ...(result.text ? { text: result.text } : {}),
      },
      processedAt,
      false,
      page.capturedAt,
    );
    if (written) await fillPageMetadata(id, result);
  }
  await deletePageSnapshot(id, page.capturedAt);
}
export async function registerPageJobs(boss: PgBoss): Promise<void> {
  await ensureReaderFromPageQueue(boss);
  await boss.work(READER_FROM_PAGE_QUEUE, { batchSize: 1 }, async ([job]) => {
    if (job) await readerFromPage(z.object({ linkId: z.uuid() }).parse(job.data).linkId);
  });
  await boss.createQueue(CLEANUP_PAGE_SNAPSHOTS_QUEUE);
  await boss.schedule(CLEANUP_PAGE_SNAPSHOTS_QUEUE, '29 3 * * *', {}, { tz: 'UTC' });
  await boss.work(CLEANUP_PAGE_SNAPSHOTS_QUEUE, { batchSize: 1 }, async () => {
    await cleanupPageSnapshots();
  });
}
