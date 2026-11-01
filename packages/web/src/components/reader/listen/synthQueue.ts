import type { TtsEngine } from './engines/types';
import { type CachedAudio, ReplayCache } from './replayCache';
import { EdgeTrimmer } from './trim';

/** Synthesized audio for one unit. Chunks arrive while the unit is still being generated. */
export type Job = {
  key: string;
  chunks: Float32Array[];
  sampleRate: number;
  done: boolean;
  failed: string;
  /** Dropped before it finished; a later request for the same audio starts a new job. */
  cancelled: boolean;
  listeners: Set<() => void>;
};

type Queued = {
  job: Job;
  text: string;
  priority: number;
  speed: number;
  voice: string;
  engine: TtsEngine;
};

export function jobKey(engine: TtsEngine, voice: string, speed: number, text: string): string {
  return `${engine.id}|${voice}|${speed}|${text}`;
}

export function jobSeconds(job: { chunks: readonly Float32Array[]; sampleRate: number }): number {
  let samples = 0;
  for (const chunk of job.chunks) samples += chunk.length;
  return samples / job.sampleRate;
}

function settled(audio: CachedAudio, key: string): Job {
  return {
    key,
    chunks: audio.chunks,
    sampleRate: audio.sampleRate,
    done: true,
    failed: '',
    cancelled: false,
    listeners: new Set(),
  };
}

/**
 * One synthesis at a time, lowest priority number first. A request for audio that is cached or
 * already queued shares that job (and may raise its priority). Finished jobs go to the replay
 * cache. `clear` drops the waiting jobs and aborts the running one.
 */
export class SynthQueue {
  private queue: Queued[] = [];
  private running: { job: Job; abort: AbortController } | null = null;
  /** A run loop is active; listeners that request more work must not start a second one. */
  private looping = false;
  private readonly inflight = new Map<string, Job>();

  constructor(readonly cache = new ReplayCache()) {}

  request(engine: TtsEngine, text: string, voice: string, speed: number, priority: number): Job {
    const key = jobKey(engine, voice, speed, text);
    const cached = this.cache.get(key);
    if (cached) return settled(cached, key);
    const shared = this.inflight.get(key);
    if (shared) {
      const waiting = this.queue.find((entry) => entry.job === shared);
      if (waiting && priority < waiting.priority) waiting.priority = priority;
      return shared;
    }
    const job: Job = {
      key,
      chunks: [],
      sampleRate: engine.sampleRate,
      done: false,
      failed: '',
      cancelled: false,
      listeners: new Set(),
    };
    this.inflight.set(key, job);
    this.queue.push({ job, text, priority, speed, voice, engine });
    void this.run();
    return job;
  }

  /**
   * Drop what is waiting and abort what is running, except the jobs whose keys are in `keep`
   * (warm-up work the next start will use).
   */
  clear(keep: ReadonlySet<string> = new Set()): void {
    this.queue = this.queue.filter((entry) => {
      if (keep.has(entry.job.key)) return true;
      this.drop(entry.job);
      return false;
    });
    if (this.running && !keep.has(this.running.job.key)) {
      this.running.abort.abort();
      this.drop(this.running.job);
    }
  }

  /** Mark a job dropped, and forget it unless a newer job already took its key. */
  private drop(job: Job): void {
    job.cancelled = true;
    if (this.inflight.get(job.key) === job) this.inflight.delete(job.key);
  }

  private async run(): Promise<void> {
    if (this.looping) return;
    this.looping = true;
    try {
      for (;;) {
        this.queue.sort((a, b) => a.priority - b.priority);
        const next = this.queue.shift();
        if (!next) return;
        const abort = new AbortController();
        this.running = { job: next.job, abort };
        await this.synthesize(next, abort);
        this.running = null;
        if (this.inflight.get(next.job.key) === next.job) this.inflight.delete(next.job.key);
        for (const listener of next.job.listeners) listener();
      }
    } finally {
      this.looping = false;
    }
  }

  private async synthesize(next: Queued, abort: AbortController): Promise<void> {
    const { job } = next;
    try {
      let trimmer: EdgeTrimmer | undefined;
      for await (const chunk of next.engine.stream(next.text, {
        voice: next.voice,
        speed: next.speed,
        signal: abort.signal,
      })) {
        if (abort.signal.aborted) break;
        job.sampleRate = next.engine.sampleRate;
        trimmer ??= new EdgeTrimmer(job.sampleRate);
        job.chunks.push(...trimmer.push(chunk));
        for (const listener of job.listeners) listener();
      }
      if (!abort.signal.aborted) {
        trimmer ??= new EdgeTrimmer(next.engine.sampleRate);
        job.sampleRate = next.engine.sampleRate;
        job.chunks.push(...trimmer.finish());
        job.done = true;
        this.cache.set(job.key, { chunks: job.chunks, sampleRate: job.sampleRate });
      }
    } catch (reason) {
      if (!abort.signal.aborted)
        job.failed = reason instanceof Error ? reason.message : String(reason);
    }
  }
}
