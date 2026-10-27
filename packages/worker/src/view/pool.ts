import { Worker } from 'node:worker_threads';
import type { StyledPage } from './stylesheets.js';

/** Two reusable threads. A timed-out/aborted thread is terminated before its slot is reused. */
export class TransformPool {
  private readonly workers = new Map<Worker, boolean>();
  private readonly cancel = new Map<Worker, () => void>();

  constructor(
    private readonly timeoutMs = 3_000,
    private readonly entry = new URL('./transform-thread.mjs', import.meta.url),
  ) {}

  async run(html: string, finalUrl: string, signal: AbortSignal): Promise<StyledPage> {
    signal.throwIfAborted();
    const worker = this.acquire();
    worker.ref();
    this.workers.set(worker, true);
    return new Promise<StyledPage>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error, output?: StyledPage) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        worker.removeAllListeners('message');
        worker.off('error', onError);
        worker.off('exit', onExit);
        this.cancel.delete(worker);
        if (error) {
          this.workers.delete(worker);
          worker.terminate().finally(() => reject(error));
        } else {
          this.workers.set(worker, false);
          worker.unref();
          if (output) resolve(output);
          else reject(new Error('transform-failed'));
        }
      };
      const abort = () => finish(new Error('aborted'));
      const timer = setTimeout(() => finish(new Error('transform-timeout')), this.timeoutMs);
      signal.addEventListener('abort', abort, { once: true });
      this.cancel.set(worker, abort);
      const onError = () => finish(new Error('transform-failed'));
      const onExit = () => finish(new Error('transform-exited'));
      worker.once('error', onError);
      worker.once('exit', onExit);
      worker.once('message', (message: Partial<StyledPage>) => {
        if (
          typeof message.html === 'string' &&
          typeof message.cssDarkTheme === 'boolean' &&
          typeof message.scriptDarkTheme === 'boolean'
        )
          finish(undefined, {
            html: message.html,
            cssDarkTheme: message.cssDarkTheme,
            scriptDarkTheme: message.scriptDarkTheme,
          });
        else finish(new Error('transform-failed'));
      });
      worker.postMessage({ html, finalUrl });
    });
  }

  private acquire(): Worker {
    for (const [worker, busy] of this.workers) if (!busy) return worker;
    if (this.workers.size >= 2) throw new Error('transform-pool-busy');
    const worker = new Worker(this.entry, {
      execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: 256 },
    });
    worker.on('error', () => this.workers.delete(worker));
    worker.on('exit', () => this.workers.delete(worker));
    worker.unref();
    this.workers.set(worker, false);
    return worker;
  }

  async close(): Promise<void> {
    for (const abort of this.cancel.values()) abort();
    await Promise.all(Array.from(this.workers.keys(), (worker) => worker.terminate()));
    this.workers.clear();
  }
}
