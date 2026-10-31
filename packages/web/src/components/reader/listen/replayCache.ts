/** Audio kept for replay: the chunks a unit was synthesized in. */
export type CachedAudio = { chunks: Float32Array[]; sampleRate: number };

/** About 64 MB of samples (4 bytes each). */
export const REPLAY_CACHE_BYTES = 64 * 1024 * 1024;

function bytesOf(audio: CachedAudio): number {
  let samples = 0;
  for (const chunk of audio.chunks) samples += chunk.length;
  return samples * Float32Array.BYTES_PER_ELEMENT;
}

/** A byte-capped, least-recently-used cache: going back a sentence costs nothing. */
export class ReplayCache {
  private readonly entries = new Map<string, CachedAudio>();
  private total = 0;

  constructor(private readonly limit = REPLAY_CACHE_BYTES) {}

  get bytes(): number {
    return this.total;
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: string): CachedAudio | undefined {
    const hit = this.entries.get(key);
    if (hit) {
      // Re-insert so the entry counts as the most recently used.
      this.entries.delete(key);
      this.entries.set(key, hit);
    }
    return hit;
  }

  set(key: string, audio: CachedAudio): void {
    const old = this.entries.get(key);
    if (old) this.total -= bytesOf(old);
    this.entries.delete(key);
    this.entries.set(key, audio);
    this.total += bytesOf(audio);
    for (const [oldest, value] of this.entries) {
      if (this.total <= this.limit || oldest === key) break;
      this.entries.delete(oldest);
      this.total -= bytesOf(value);
    }
  }
}
