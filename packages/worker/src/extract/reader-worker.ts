import { Worker } from 'node:worker_threads';
import type { PageContent } from './reader-page.js';

/** One isolated extraction per thread; terminate even synchronous parser loops. */
export function extractPage(
  html: string,
  url: string,
  options: { timeoutMs?: number; entry?: URL; description?: string } = {},
): Promise<PageContent> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(options.entry ?? new URL('./reader-thread.mjs', import.meta.url), {
      execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: 256 },
    });
    let settled = false;
    const finish = (error?: Error, result?: PageContent) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Wait for termination before returning so timed-out work cannot keep running.
      void worker.terminate().then(() => {
        if (error) reject(error);
        else resolve(result ?? {});
      });
    };
    const timer = setTimeout(() => finish(new Error('reader-timeout')), options.timeoutMs ?? 5_000);
    worker.once('error', () => finish(new Error('reader-failed')));
    worker.once('exit', () => finish(new Error('reader-exited')));
    worker.once('message', (message: { result?: PageContent; error?: string }) => {
      if (message.result) finish(undefined, message.result);
      else finish(new Error('reader-failed'));
    });
    worker.postMessage({ html, url, description: options.description });
  });
}
