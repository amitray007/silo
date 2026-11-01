/** Append adjacent views without copying their samples. */
function append(chunks: Float32Array[], chunk: Float32Array): void {
  if (!chunk.length) return;
  const last = chunks.at(-1);
  if (last?.buffer === chunk.buffer && last.byteOffset + last.byteLength === chunk.byteOffset) {
    chunks[chunks.length - 1] = new Float32Array(
      last.buffer,
      last.byteOffset,
      last.length + chunk.length,
    );
  } else chunks.push(chunk);
}

export type TrimmedChunk = { pcm: Float32Array; silence: boolean };

/** Keep released silence separate from speech, even when their sample views touch. */
function emit(out: TrimmedChunk[], chunks: Float32Array[], silence = false): void {
  const last = out.at(-1);
  const joined = last?.silence === silence ? [last.pcm] : [];
  for (const chunk of chunks) append(joined, chunk);
  if (last?.silence === silence) out.pop();
  for (const pcm of joined) out.push({ pcm, silence });
}

/** Streaming edge trim. Fixed RMS windows make the result independent of engine chunk boundaries. */
export class EdgeTrimmer {
  private readonly window: number;
  private readonly lead: number;
  private readonly tail: number;
  private readonly fade: number;
  private partial: Float32Array = new Float32Array(0);
  private pending: Float32Array[] = [];
  private samples = 0;
  private silent = 0;
  private started = false;
  private faded = 0;

  constructor(private readonly sampleRate: number) {
    this.window = Math.max(1, Math.round(sampleRate * 0.01));
    this.lead = Math.round(sampleRate * 0.03);
    this.tail = Math.round(sampleRate * 0.06);
    this.fade = Math.max(2, Math.round(sampleRate * 0.005));
  }

  /** Remove a prefix, retaining views of the rest. */
  private take(count: number): Float32Array[] {
    const out: Float32Array[] = [];
    let used = 0;
    while (count > 0) {
      const chunk = this.pending[used];
      if (!chunk) break;
      const size = Math.min(count, chunk.length);
      append(out, chunk.subarray(0, size));
      this.samples -= size;
      count -= size;
      if (size < chunk.length) {
        this.pending[used] = chunk.subarray(size);
        break;
      }
      used += 1;
    }
    this.pending = this.pending.slice(used);
    return out;
  }

  private accept(window: Float32Array, out: TrimmedChunk[]): void {
    let sum = 0;
    for (const value of window) sum += value * value;
    const speech = sum / window.length >= 1e-5; // -50 dBFS, squared RMS.
    append(this.pending, window);
    this.samples += window.length;
    if (speech) {
      // The pending prefix is all silence once the kept tail has been emitted.
      if (this.started && this.silent > this.tail)
        emit(out, this.take(this.samples - window.length), true);
      this.started = true;
      this.silent = 0;
      // Retain enough audio to fade the end even if the stream stops in speech.
      emit(out, this.take(Math.max(0, this.samples - this.fade)));
    } else if (this.started) {
      this.silent += window.length;
      // Release the kept tail as it arrives; only its fade and excess silence must wait.
      const hold = this.fade + Math.max(0, this.silent - this.tail);
      emit(out, this.take(Math.max(0, this.samples - hold)));
    } else this.take(Math.max(0, this.samples - this.lead));
  }

  private fadeIn(chunks: TrimmedChunk[]): TrimmedChunk[] {
    const out: TrimmedChunk[] = [];
    for (const { pcm: chunk, silence } of chunks) {
      const count = Math.min(chunk.length, this.fade - this.faded);
      if (count > 0) {
        const edge = chunk.slice(0, count);
        for (let i = 0; i < count; i += 1)
          edge[i] = ((edge[i] ?? 0) * (this.faded + i)) / (this.fade - 1);
        this.faded += count;
        emit(out, [edge], silence);
      }
      emit(out, [chunk.subarray(count)], silence);
    }
    return out;
  }

  push(chunk: Float32Array): TrimmedChunk[] {
    const out: TrimmedChunk[] = [];
    let offset = 0;
    if (this.partial.length) {
      const count = Math.min(this.window - this.partial.length, chunk.length);
      const joined = new Float32Array(this.partial.length + count);
      joined.set(this.partial);
      joined.set(chunk.subarray(0, count), this.partial.length);
      offset = count;
      this.partial = joined;
      if (joined.length < this.window) return out;
      this.accept(joined, out);
      this.partial = new Float32Array(0);
    }
    while (offset + this.window <= chunk.length) {
      this.accept(chunk.subarray(offset, offset + this.window), out);
      offset += this.window;
    }
    this.partial = chunk.subarray(offset);
    return this.fadeIn(out);
  }

  finish(): TrimmedChunk[] {
    const out: TrimmedChunk[] = [];
    if (this.partial.length) this.accept(this.partial, out);
    this.partial = new Float32Array(0);
    if (!this.started)
      return [{ pcm: new Float32Array(Math.round(this.sampleRate * 0.05)), silence: false }];
    const keep = Math.min(this.samples, this.samples - this.silent + this.tail);
    const tail = this.take(keep);
    this.pending = [];
    this.samples = 0;
    // Copy only the final 5 ms. Earlier samples may already belong to the player/cache.
    let remaining = this.fade;
    for (let j = tail.length - 1; j >= 0 && remaining > 0; j -= 1) {
      const chunk = tail[j];
      if (!chunk) continue;
      const count = Math.min(chunk.length, remaining);
      const edge = chunk.slice(chunk.length - count);
      for (let i = count - 1; i >= 0; i -= 1) {
        edge[i] = ((edge[i] ?? 0) * (this.fade - remaining + count - 1 - i)) / (this.fade - 1);
      }
      tail.splice(j, 1, chunk.subarray(0, chunk.length - count), edge);
      remaining -= count;
    }
    emit(out, tail);
    return this.fadeIn(out);
  }
}
