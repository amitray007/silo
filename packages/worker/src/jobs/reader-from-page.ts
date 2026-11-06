import {
  cleanupPageSnapshots,
  deletePageSnapshot,
  fillPageMetadata,
  getPageSnapshot,
  recordReader,
} from '@silo/core';
import { ensureReaderFromPageQueue } from '@silo/queue';
import type { PgBoss } from 'pg-boss';
import { z } from 'zod';
import { extract } from '../extract/extract.js';

export async function readerFromPage(id: string): Promise<void> {
  const page = await getPageSnapshot(id);
  if (!page) return;
  const result = await extract({ url: page.url, html: page.html, contentType: 'text/html' }).catch(
    () => {
      throw new Error('Browser page extraction failed');
    },
  );
  if (result.reader && !result.readerFailed && result.access !== 'blocked') {
    const written = await recordReader(
      id,
      {
        status: 'reader',
        reader: result.reader,
        readerSource: 'extension',
        ...(result.text ? { text: result.text } : {}),
      },
      page.capturedAt,
    );
    if (written) await fillPageMetadata(id, result);
  }
  await deletePageSnapshot(id, page.capturedAt);
}
export async function registerPageJobs(boss: PgBoss): Promise<void> {
  await ensureReaderFromPageQueue(boss);
  await boss.work('reader-from-page', { batchSize: 1 }, async ([job]) => {
    if (job) await readerFromPage(z.object({ linkId: z.uuid() }).parse(job.data).linkId);
  });
  await boss.createQueue('cleanup-page-snapshots');
  await boss.schedule('cleanup-page-snapshots', '29 3 * * *', {}, { tz: 'UTC' });
  await boss.work('cleanup-page-snapshots', { batchSize: 1 }, async () => {
    await cleanupPageSnapshots();
  });
}
