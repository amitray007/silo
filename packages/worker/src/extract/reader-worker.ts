import { Worker } from 'node:worker_threads';
import type { PageContent } from './reader-page.js';

type PageRequest = { html: string; url: string; description?: string };
type Reply = { ready?: boolean; result?: PageContent };

/** Rejecting extraction lets the existing pg-boss retry/backoff and DLQ handle failures. */
export class ReaderExtractionError extends Error {}

/** A single warm thread serializes CPU work while fetch jobs stay concurrent. */
export class ReaderPool {
  private worker: Worker | undefined;
  private tail: Promise<void> = Promise.resolve();
  private cancelActive: (() => void) | undefined;
  private closed = false;

  constructor(
    private readonly options: { timeoutMs?: number; startupTimeoutMs?: number; entry?: URL } = {},
  ) {}

  run(html: string, url: string, description?: string): Promise<PageContent> {
    const job = this.tail.then(async () => {
      if (this.closed) throw new ReaderExtractionError('reader-closed');
      const worker = this.worker ?? (await this.start());
      worker.ref();
      return this.exchange(worker, { html, url, ...(description ? { description } : {}) });
    });
    // One rejected page must not block later queued pages or leave an unhandled rejection.
    this.tail = job.then(
      () => {},
      () => {},
    );
    return job;
  }

  private async start(): Promise<Worker> {
    let worker: Worker;
    try {
      worker = new Worker(this.options.entry ?? new URL('./reader-thread.mjs', import.meta.url), {
        execArgv: [],
        resourceLimits: { maxOldGenerationSizeMb: 256 },
      });
    } catch {
      throw new ReaderExtractionError('reader-startup-failed');
    }
    this.worker = worker;
    const forget = () => {
      if (this.worker === worker) this.worker = undefined;
    };
    worker.on('error', forget);
    worker.once('exit', forget);
    // The ready handshake has its own deadline. Page time starts only at postMessage.
    await this.exchange(worker);
    return worker;
  }

  private exchange(worker: Worker, request?: PageRequest): Promise<PageContent> {
    return new Promise((resolve, reject) => {
      const phase = request ? 'reader' : 'reader-startup';
      const timeoutMs = request
        ? (this.options.timeoutMs ?? 5_000)
        : (this.options.startupTimeoutMs ?? 30_000);
      let settled = false;
      const finish = (error?: ReaderExtractionError, result: PageContent = {}) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        worker.off('message', onMessage);
        worker.off('error', onError);
        worker.off('exit', onExit);
        this.cancelActive = undefined;
        if (error) void this.terminate(worker).then(() => reject(error), reject);
        else {
          worker.unref();
          resolve(result);
        }
      };
      const onMessage = (reply: Reply) => {
        if (!request && reply.ready) finish();
        else if (request && reply.result) finish(undefined, reply.result);
        else finish(new ReaderExtractionError(`${phase}-failed`));
      };
      const onError = () => finish(new ReaderExtractionError(`${phase}-failed`));
      const onExit = () => finish(new ReaderExtractionError(`${phase}-exited`));
      const timer = setTimeout(
        () => finish(new ReaderExtractionError(`${phase}-timeout`)),
        timeoutMs,
      );
      this.cancelActive = () => finish(new ReaderExtractionError('reader-closed'));
      worker.once('message', onMessage);
      worker.once('error', onError);
      worker.once('exit', onExit);
      if (request) worker.postMessage(request);
    });
  }

  private async terminate(worker: Worker): Promise<void> {
    if (this.worker === worker) this.worker = undefined;
    await worker.terminate();
  }

  async close(): Promise<void> {
    this.closed = true;
    this.cancelActive?.();
    if (this.worker) await this.terminate(this.worker);
    await this.tail;
  }
}

let pool: ReaderPool | undefined;

export function extractPage(
  html: string,
  url: string,
  options: { description?: string } = {},
): Promise<PageContent> {
  pool ??= new ReaderPool();
  return pool.run(html, url, options.description);
}

export async function closeReaderPool(): Promise<void> {
  const current = pool;
  pool = undefined;
  await current?.close();
}
