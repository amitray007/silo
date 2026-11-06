import { Worker } from 'node:worker_threads';
import type { EditorCode } from './code-editors.js';
import { readerThreadCount, readerTimeoutMs } from './reader-limits.js';
import type { PageContent } from './reader-page.js';

type PageRequest = {
  html: string;
  url: string;
  description?: string;
  operation?: 'sanitize';
  codeEditors?: [string, EditorCode][];
};
type Reply = { ready?: boolean; result?: PageContent };

/** Rejecting extraction lets the existing pg-boss retry/backoff and DLQ handle failures. */
export class ReaderExtractionError extends Error {}

type Job = {
  request: PageRequest;
  signal: AbortSignal | undefined;
  resolve: (content: PageContent) => void;
  reject: (reason: unknown) => void;
  /** Drops the queued-phase abort listener once the job leaves the queue. */
  detach: () => void;
};

/** One thread and what it is doing. A busy slot is running a page or starting its thread. */
type Slot = {
  worker: Worker | undefined;
  busy: boolean;
  /** Set when a job's thread was lost, so the slot starts a replacement once the job settles. */
  respawn: boolean;
  cancel: (() => void) | undefined;
  task: Promise<void>;
};

export type ReaderPoolOptions = {
  /** Threads to run; defaults to `readerThreadCount()`. */
  size?: number;
  /** A fixed page deadline, replacing the size-scaled one. */
  timeoutMs?: number;
  startupTimeoutMs?: number;
  entry?: URL;
};

/**
 * A few warm threads serialize CPU work per thread while fetch jobs stay concurrent. Pages go to an
 * idle thread, or wait in FIFO order; the queue holds only what the callers (pg-boss's local
 * concurrency) have in flight. Each thread is killed on its own deadline and replaced alone.
 */
export class ReaderPool {
  private readonly slots: Slot[];
  private readonly queue: Job[] = [];
  private closed = false;

  constructor(private readonly options: ReaderPoolOptions = {}) {
    const size = options.size ?? readerThreadCount();
    this.slots = Array.from({ length: Math.max(1, size) }, () => ({
      worker: undefined,
      busy: false,
      respawn: false,
      cancel: undefined,
      task: Promise.resolve(),
    }));
  }

  run(html: string, url: string, description?: string): Promise<PageContent> {
    return this.enqueue({ html, url, ...(description ? { description } : {}) });
  }

  sanitize(
    html: string,
    url: string,
    signal: AbortSignal,
    codeEditors: [string, EditorCode][] = [],
  ): Promise<PageContent> {
    return this.enqueue({ html, url, operation: 'sanitize', codeEditors }, signal);
  }

  /**
   * Start every thread in the background so the first jobs find them warm (a cold start costs
   * seconds of module loading). A starting thread counts as busy, so jobs use the others; failures
   * are left to the next job, which starts its own thread and reports the error. The promise
   * settles, never rejecting, once every thread is idle and warm, or has failed to start.
   */
  prewarm(): Promise<void> {
    if (!this.closed) for (const slot of this.slots) this.warm(slot);
    return Promise.all(this.slots.map((slot) => slot.task)).then(() => {});
  }

  private warm(slot: Slot): void {
    if (this.closed || slot.busy || slot.worker) return;
    slot.busy = true;
    slot.task = this.start(slot)
      .then(
        () => {},
        () => {},
      )
      .finally(() => this.release(slot));
  }

  private enqueue(request: PageRequest, signal?: AbortSignal): Promise<PageContent> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason);
      if (this.closed) return reject(new ReaderExtractionError('reader-closed'));
      const onAbort = () => {
        const at = this.queue.indexOf(job);
        if (at !== -1) this.queue.splice(at, 1);
        reject(signal?.reason);
      };
      const job: Job = {
        request,
        signal,
        resolve,
        reject,
        detach: () => signal?.removeEventListener('abort', onAbort),
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.queue.push(job);
      this.pump();
    });
  }

  /** Hand queued pages to idle threads, oldest first, preferring a thread that is already warm. */
  private pump(): void {
    while (!this.closed) {
      const idle = this.slots.filter((slot) => !slot.busy);
      const slot = idle.find((candidate) => candidate.worker) ?? idle[0];
      const job = slot ? this.queue.shift() : undefined;
      if (!slot || !job) return;
      this.dispatch(slot, job);
    }
  }

  private dispatch(slot: Slot, job: Job): void {
    job.detach();
    slot.busy = true;
    slot.task = this.runJob(slot, job)
      .then(job.resolve, job.reject)
      .finally(() => this.release(slot));
  }

  private async runJob(slot: Slot, job: Job): Promise<PageContent> {
    job.signal?.throwIfAborted();
    const worker = slot.worker ?? (await this.start(slot));
    job.signal?.throwIfAborted();
    worker.ref();
    return this.exchange(slot, worker, job.request, job.signal);
  }

  /**
   * A slot that lost its thread mid-job is replaced now so the next page skips the cold start. The
   * job's task then lasts until the replacement is ready, so `close()` and `prewarm()` wait for it.
   */
  private release(slot: Slot): Promise<void> {
    slot.busy = false;
    if (slot.respawn) {
      slot.respawn = false;
      this.warm(slot);
    }
    const replacing = slot.busy ? slot.task : Promise.resolve();
    this.pump();
    return replacing;
  }

  private async start(slot: Slot): Promise<Worker> {
    let worker: Worker;
    try {
      worker = new Worker(this.options.entry ?? new URL('./reader-thread.mjs', import.meta.url), {
        execArgv: [],
        resourceLimits: { maxOldGenerationSizeMb: 256 },
      });
    } catch {
      throw new ReaderExtractionError('reader-startup-failed');
    }
    slot.worker = worker;
    const forget = () => {
      if (slot.worker === worker) slot.worker = undefined;
    };
    worker.on('error', forget);
    worker.once('exit', forget);
    // The ready handshake has its own deadline. Page time starts only at postMessage.
    await this.exchange(slot, worker);
    return worker;
  }

  private exchange(
    slot: Slot,
    worker: Worker,
    request?: PageRequest,
    signal?: AbortSignal,
  ): Promise<PageContent> {
    return new Promise((resolve, reject) => {
      const phase = request ? 'reader' : 'reader-startup';
      const timeoutMs = request
        ? (this.options.timeoutMs ?? readerTimeoutMs(request.html))
        : (this.options.startupTimeoutMs ?? 30_000);
      let settled = false;
      const finish = (error?: ReaderExtractionError, result: PageContent = {}) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        worker.off('message', onMessage);
        worker.off('error', onError);
        worker.off('exit', onExit);
        signal?.removeEventListener('abort', onAbort);
        slot.cancel = undefined;
        if (error) {
          // Not after a failed startup: that would retry a broken thread in a loop.
          if (request) slot.respawn = true;
          void this.terminate(slot, worker).then(() => reject(error), reject);
        } else {
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
      const onAbort = () => finish(new ReaderExtractionError('reader-cancelled'));
      const timer = setTimeout(
        () => finish(new ReaderExtractionError(`${phase}-timeout`)),
        timeoutMs,
      );
      slot.cancel = () => finish(new ReaderExtractionError('reader-closed'));
      worker.once('message', onMessage);
      worker.once('error', onError);
      worker.once('exit', onExit);
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
      else if (request) worker.postMessage(request);
    });
  }

  private async terminate(slot: Slot, worker: Worker): Promise<void> {
    if (slot.worker === worker) slot.worker = undefined;
    await worker.terminate();
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const job of this.queue.splice(0)) {
      job.detach();
      job.reject(new ReaderExtractionError('reader-closed'));
    }
    for (const slot of this.slots) slot.cancel?.();
    await Promise.all(
      this.slots.map(async (slot) => {
        if (slot.worker) await this.terminate(slot, slot.worker);
        await slot.task;
      }),
    );
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

/** Start the shared threads ahead of the first job; never throws or blocks. */
export function prewarmReaderPool(): void {
  pool ??= new ReaderPool();
  void pool.prewarm();
}

export async function closeReaderPool(): Promise<void> {
  const current = pool;
  pool = undefined;
  await current?.close();
}

/** Shares the warm CPU thread, including termination on the browser's hard deadline. */
export function sanitizeRenderedPage(
  html: string,
  url: string,
  signal: AbortSignal,
  codeEditors: [string, EditorCode][] = [],
): Promise<PageContent> {
  pool ??= new ReaderPool();
  return pool.sanitize(html, url, signal, codeEditors);
}
