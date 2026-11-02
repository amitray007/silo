import type { StretchReply, StretchRequest } from './stretchWorker';

type Pending = {
  resolve(pcm: Float32Array): void;
  reject(reason: Error): void;
};

/** One processing worker per player. A generation change terminates even a busy transform. */
export class StretchProcessor {
  private worker: Worker | undefined;
  private sequence = 0;
  private readonly pending = new Map<number, Pending>();

  /** Transfer a newly joined buffer, never a chunk owned by a synthesis job or replay cache. */
  async process(chunks: readonly Float32Array[], rate: number): Promise<Float32Array> {
    const input = new Float32Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
      input.set(chunk, offset);
      offset += chunk.length;
    }
    const worker = this.worker ?? this.create();
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        const message: StretchRequest = { id, input, rate };
        worker.postMessage(message, [input.buffer]);
      } catch (reason) {
        this.cancel(reason instanceof Error ? reason : new Error(String(reason)));
      }
    });
  }

  cancel(reason: Error = new DOMException('Stopped', 'AbortError')): void {
    this.worker?.terminate();
    this.worker = undefined;
    for (const request of this.pending.values()) request.reject(reason);
    this.pending.clear();
  }

  private create(): Worker {
    const worker = new Worker(new URL('./stretchWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }: MessageEvent<StretchReply>) => {
      const request = this.pending.get(data.id);
      this.pending.delete(data.id);
      if ('error' in data) request?.reject(new Error(data.error));
      else request?.resolve(data.pcm);
    };
    worker.onerror = (event) => {
      if (this.worker === worker)
        this.cancel(new Error(event.message || 'Audio processing failed'));
    };
    worker.onmessageerror = () => {
      if (this.worker === worker)
        this.cancel(new Error('Audio processing returned unreadable data'));
    };
    this.worker = worker;
    return worker;
  }
}
