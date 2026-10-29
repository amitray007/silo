import { enrichJobSchema } from '@silo/core';
import { enrichLink } from './enrich.js';

/**
 * Runs one `enrich-link` job: validate the payload, then call `enrichLink`
 * with the link id and the job context. Jobs queued before the trigger and
 * previousStatus fields existed carry only `linkId`; `enrichJobSchema` fills
 * them with the cautious values (a sweep of an `enriching` link). A payload
 * with no usable `linkId` is dropped with a log line, not retried.
 */
export async function runEnrichJob(
  data: unknown,
  enrich: typeof enrichLink = enrichLink,
): Promise<void> {
  const payload = enrichJobSchema.safeParse(data);
  if (!payload.success) {
    console.error('[silo/worker] enrich-link: dropping job with an invalid payload');
    return;
  }
  const { linkId, trigger, previousStatus } = payload.data;
  await enrich(linkId, undefined, { trigger, previousStatus });
}
