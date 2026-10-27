import { PageViewerUnavailableError } from '@silo/core';

/** Bounded waiting room. Acquiring transfers a slot directly to the oldest waiter. */
export class ViewLimit {
  private active = 0;
  private readonly queue = new Set<() => void>();

  constructor(private readonly waitMs = 1_000) {}

  async acquire(signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted();
    if (this.active < 2) {
      this.active++;
      return () => this.release();
    }
    if (this.queue.size >= 32) throw new PageViewerUnavailableError();
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        this.queue.delete(ready);
        signal.removeEventListener('abort', abort);
      };
      const ready = () => {
        cleanup();
        resolve();
      };
      const abort = () => {
        cleanup();
        reject(new PageViewerUnavailableError());
      };
      const timer = setTimeout(abort, this.waitMs);
      this.queue.add(ready);
      signal.addEventListener('abort', abort, { once: true });
    });
    return () => this.release();
  }

  private release(): void {
    const next = this.queue.values().next().value;
    if (next) next();
    else this.active--;
  }
}
