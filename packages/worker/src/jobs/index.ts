/**
 * Registers all three scheduled maintenance jobs (scheduling-jobs slice) on a
 * STARTED `boss`. Called once from `startWorker()`. Each job's own module
 * owns its queue name, cron cadence, handler, and failure isolation — see
 * `purge-trash.ts`, `sweep-enriching.ts`, `dlq-alert.ts`.
 *
 * Registration order doesn't matter (each job's `createQueue` + `schedule` +
 * `work` are independent), but running them sequentially (rather than
 * `Promise.all`) keeps failure attribution simple if one throws during
 * startup.
 */

import type { PgBoss } from 'pg-boss';
import { registerDlqAlertJob } from './dlq-alert.js';
import { registerOAuthCleanupJob } from './oauth-cleanup.js';
import { registerPurgeTrashJob } from './purge-trash.js';
import { registerSweepEnrichingJob } from './sweep-enriching.js';

export { DLQ_ALERT_CRON, DLQ_ALERT_QUEUE, registerDlqAlertJob } from './dlq-alert.js';
export {
  OAUTH_CLEANUP_CRON,
  OAUTH_CLEANUP_QUEUE,
  registerOAuthCleanupJob,
  runOAuthCleanup,
} from './oauth-cleanup.js';
export {
  PURGE_TRASH_CRON,
  PURGE_TRASH_QUEUE,
  registerPurgeTrashJob,
  runPurgeTrash,
} from './purge-trash.js';
export {
  registerSweepEnrichingJob,
  runSweepEnriching,
  SWEEP_ENRICHING_CRON,
  SWEEP_ENRICHING_QUEUE,
} from './sweep-enriching.js';

export async function registerScheduledJobs(boss: PgBoss): Promise<void> {
  await registerPurgeTrashJob(boss);
  await registerSweepEnrichingJob(boss);
  await registerDlqAlertJob(boss);
  await registerOAuthCleanupJob(boss);
}
