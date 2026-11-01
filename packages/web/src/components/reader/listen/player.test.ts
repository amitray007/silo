import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TtsEngine } from './engines/types';
import { Player, type PlayerEvents } from './player';
import type { Segment } from './segments';

/** A clock and a buffer source that only record what was scheduled. */
class FakeAudio {
  currentTime = 0;
  state = 'running';
  destination = {};
  starts: { at: number; duration: number }[] = [];
  stopped = 0;
  resume = async () => {};
  createBuffer(_channels: number, length: number, sampleRate: number) {
    const data = new Float32Array(length);
    return { duration: length / sampleRate, getChannelData: () => data };
  }
  createBufferSource() {
    const node = {
      buffer: undefined as { duration: number } | undefined,
      onended: null as (() => void) | null,
      connect: () => {},
      start: (at: number) => this.starts.push({ at, duration: node.buffer?.duration ?? 0 }),
      stop: () => {
        this.stopped += 1;
      },
    };
    return node;
  }
}

const SAMPLE_RATE = 24000;
const block = (n: number) => ({ n }) as unknown as Element;

/** One sentence per paragraph, each about 80 characters, so every unit stands alone. */
function sentences(count: number): Segment[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    text: `${`Sentence number ${i} says something long enough to stay a unit of its own, truly.`}`,
    range: {} as Range,
    block: block(i),
    kind: 'text' as const,
  }));
}

type Fake = { engine: TtsEngine; calls: { text: string; signal?: AbortSignal | undefined }[] };

/** An engine that answers each unit with `chunks` chunks of `seconds` / chunks each. */
function fakeEngine({
  supportsSpeed = true,
  seconds = 1,
  chunks = 1,
  fail = '',
}: {
  supportsSpeed?: boolean;
  seconds?: number;
  chunks?: number;
  fail?: string;
} = {}): Fake {
  const calls: Fake['calls'] = [];
  const engine: TtsEngine = {
    id: supportsSpeed ? 'kokoro' : 'phonon',
    supportsSpeed,
    sampleRate: SAMPLE_RATE,
    device: 'test',
    load: async () => {},
    voices: () => [],
    dispose: () => {},
    async *stream(text, { signal }) {
      calls.push({ text, signal });
      if (fail) throw new Error(fail);
      for (let i = 0; i < chunks; i += 1) {
        await Promise.resolve();
        if (signal?.aborted) return;
        yield new Float32Array(Math.round((SAMPLE_RATE * seconds) / chunks)).fill(0.5);
      }
    },
  };
  return { engine, calls };
}

function setup(segmentCount = 6, rate = 1) {
  const audio = new FakeAudio();
  const events = {
    sentence: vi.fn(),
    buffering: vi.fn(),
    finished: vi.fn(),
    failed: vi.fn(),
    firstAudio: vi.fn(),
  } satisfies PlayerEvents;
  const list = sentences(segmentCount);
  let clock = 1000;
  const settings = { rate, voice: '' };
  const player = new Player({
    context: () => audio as unknown as AudioContext,
    segments: () => list,
    settings: () => settings,
    events,
    now: () => clock,
  });
  return { audio, events, player, settings, advance: (ms: number) => (clock += ms) };
}

const flush = () => vi.advanceTimersByTimeAsync(40);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('Player scheduling', () => {
  it('schedules units back to back with the planned pause between them', async () => {
    const { audio, player } = setup(3);
    const { engine } = fakeEngine({ seconds: 1 });
    player.start(engine, 0);
    await flush();
    await flush();
    expect(audio.starts).toHaveLength(3);
    const [a, b, c] = audio.starts;
    // Each unit ends a paragraph, so 150 ms of silence follows it.
    expect(b?.at).toBeCloseTo((a?.at ?? 0) + 1 + 0.15, 6);
    expect(c?.at).toBeCloseTo((b?.at ?? 0) + 1 + 0.15, 6);
    player.halt();
  });

  it('streams a unit chunk by chunk when the engine has no speed option and speed is 1x', async () => {
    const { audio, player } = setup(1);
    const { engine } = fakeEngine({ supportsSpeed: false, seconds: 0.8, chunks: 10 });
    player.start(engine, 0);
    await flush();
    await flush();
    expect(audio.starts).toHaveLength(10);
    for (let i = 1; i < audio.starts.length; i += 1) {
      const previous = audio.starts[i - 1];
      expect(audio.starts[i]?.at).toBeCloseTo((previous?.at ?? 0) + (previous?.duration ?? 0), 6);
    }
    player.halt();
  });

  it('stretches the whole unit for an engine with no speed option at other speeds', async () => {
    const { audio, player } = setup(1, 2);
    const { engine } = fakeEngine({ supportsSpeed: false, seconds: 1, chunks: 5 });
    player.start(engine, 0);
    await flush();
    await flush();
    expect(audio.starts).toHaveLength(1);
    expect(audio.starts[0]?.duration).toBeCloseTo(0.5, 2);
    player.halt();
  });

  it('reports the time from the press to the first scheduled sound', async () => {
    const { player, events, advance } = setup(1);
    const { engine } = fakeEngine();
    player.press();
    advance(73);
    player.start(engine, 0);
    await flush();
    expect(events.firstAudio).toHaveBeenCalledTimes(1);
    expect(events.firstAudio).toHaveBeenCalledWith(73);
    player.halt();
  });

  it('moves the highlighted sentence with the audio clock', async () => {
    const { audio, player, events } = setup(3);
    const { engine } = fakeEngine({ seconds: 1 });
    player.start(engine, 0);
    await flush();
    await flush();
    audio.currentTime = 0.5;
    await flush();
    audio.currentTime = 1.5;
    await flush();
    audio.currentTime = 2.8;
    await flush();
    expect(events.sentence.mock.calls.map((call) => call[0])).toEqual([0, 1, 2]);
    player.halt();
  });

  it('finishes once the last unit has played', async () => {
    const { audio, player, events } = setup(2);
    const { engine } = fakeEngine({ seconds: 1 });
    player.start(engine, 0);
    await flush();
    await flush();
    expect(events.finished).not.toHaveBeenCalled();
    audio.currentTime = 5;
    await flush();
    expect(events.finished).toHaveBeenCalledTimes(1);
  });

  it('reports a failed unit and stops scheduling', async () => {
    const { audio, player, events } = setup(2);
    const { engine } = fakeEngine({ fail: 'model exploded' });
    player.start(engine, 0);
    await flush();
    await flush();
    expect(events.failed).toHaveBeenCalledWith('model exploded');
    expect(audio.starts).toHaveLength(0);
  });
});

describe('Player queue', () => {
  it('keeps about 20 seconds and at least 3 units synthesized ahead, not the whole article', async () => {
    const { audio, player } = setup(40);
    const { engine, calls } = fakeEngine({ seconds: 4 });
    player.start(engine, 0);
    for (let i = 0; i < 12; i += 1) await flush();
    // Each unit is 4 s: 20 s needs 5 units; more than 12 ahead is never requested.
    expect(calls.length).toBeGreaterThanOrEqual(5);
    expect(calls.length).toBeLessThan(14);
    const before = calls.length;
    audio.currentTime = 30;
    for (let i = 0; i < 12; i += 1) await flush();
    expect(calls.length).toBeGreaterThan(before);
    player.halt();
  });

  it('asks for the clicked unit first and in order after it', async () => {
    const { player } = setup(10);
    const { engine, calls } = fakeEngine({ seconds: 2 });
    player.start(engine, 4);
    for (let i = 0; i < 6; i += 1) await flush();
    expect(calls.slice(0, 3).map((call) => call.text.match(/number (\d+)/)?.[1])).toEqual([
      '4',
      '5',
      '6',
    ]);
    player.halt();
  });

  it('cancels stale work and stops sound when the reader jumps', async () => {
    const { audio, player } = setup(10);
    // Unit 0 plays; unit 1 is still being synthesized when the reader jumps.
    const calls: { text: string; signal: AbortSignal | undefined }[] = [];
    const engine: TtsEngine = {
      ...fakeEngine().engine,
      async *stream(text, { signal }) {
        calls.push({ text, signal });
        if (/number 0 /.test(text)) {
          yield new Float32Array(SAMPLE_RATE);
          return;
        }
        if (/number [1-6] /.test(text)) {
          await new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve()));
          return;
        }
        yield new Float32Array(SAMPLE_RATE);
      },
    };
    player.start(engine, 0);
    await flush();
    await flush();
    expect(audio.starts).toHaveLength(1);
    const running = calls.find((call) => /number 1 /.test(call.text));
    expect(running?.signal?.aborted).toBe(false);
    player.start(engine, 7);
    expect(running?.signal?.aborted).toBe(true);
    expect(audio.stopped).toBe(1);
    await flush();
    await flush();
    expect(calls.some((call) => /number 7 /.test(call.text))).toBe(true);
    expect(audio.starts.length).toBeGreaterThan(1);
    player.halt();
  });

  it('replays from the cache without synthesizing again', async () => {
    const { player, audio } = setup(2);
    const { engine, calls } = fakeEngine({ seconds: 1 });
    player.start(engine, 0);
    await flush();
    await flush();
    const first = calls.length;
    audio.currentTime = 0;
    player.start(engine, 0);
    await flush();
    expect(calls.length).toBe(first);
    player.halt();
  });

  it('warm-up synthesizes the first units so the next start is immediate', async () => {
    const { player, audio, events, advance } = setup(4);
    const { engine, calls } = fakeEngine({ seconds: 1 });
    player.warm(engine, 0);
    await flush();
    await flush();
    expect(calls).toHaveLength(2);
    player.press();
    advance(5);
    player.start(engine, 0);
    expect(audio.starts.length).toBeGreaterThan(0);
    expect(events.firstAudio).toHaveBeenCalledWith(5);
    expect(calls.length).toBeLessThanOrEqual(3);
    player.halt();
  });
});

describe('Player warm-up, release and underrun', () => {
  /** An engine that finishes a unit only when the test says so. */
  function gated() {
    const calls: { text: string; signal: AbortSignal | undefined }[] = [];
    const gates = new Map<string, () => void>();
    const engine: TtsEngine = {
      ...fakeEngine().engine,
      async *stream(text, { signal }) {
        calls.push({ text, signal });
        await new Promise<void>((resolve) => gates.set(text, resolve));
        if (signal?.aborted) return;
        yield new Float32Array(SAMPLE_RATE);
      },
    };
    const finish = (n: number) => {
      for (const [text, open] of gates) if (text.includes(`number ${n} `)) open();
    };
    return { engine, calls, finish };
  }

  it('keeps warm-up work that is still running when Play is pressed', async () => {
    const { player, audio, events, advance } = setup(4);
    const { engine, calls, finish } = gated();
    player.warm(engine, 0);
    await flush();
    expect(calls).toHaveLength(1);
    player.press();
    advance(9);
    player.start(engine, 0);
    // The warm-up job was not aborted, and Play did not start a second synthesis of it.
    expect(calls[0]?.signal?.aborted).toBe(false);
    await flush();
    expect(calls.filter((call) => /number 0 /.test(call.text))).toHaveLength(1);
    finish(0);
    await flush();
    expect(audio.starts.length).toBeGreaterThan(0);
    expect(events.firstAudio).toHaveBeenCalledWith(9);
    player.halt();
  });

  it('still drops warm-up work for other sentences when the reader jumps elsewhere', async () => {
    const { player } = setup(10);
    const { engine, calls } = gated();
    player.warm(engine, 0);
    await flush();
    player.start(engine, 6);
    expect(calls[0]?.signal?.aborted).toBe(true);
    player.halt();
  });

  it('lets go of a unit once it has played, and replays it from the cache', async () => {
    const { player, audio } = setup(6);
    const { engine, calls } = fakeEngine({ seconds: 1 });
    player.start(engine, 0);
    for (let i = 0; i < 4; i += 1) await flush();
    const plan = () => (player as unknown as { plan: { jobs: unknown[] } }).plan;
    expect(plan().jobs[0]).toBeDefined();
    audio.currentTime = 3.5;
    await flush();
    expect(
      plan()
        .jobs.slice(0, 3)
        .every((job) => job === undefined),
    ).toBe(true);
    const made = calls.length;
    audio.currentTime = 0;
    player.start(engine, 1);
    await flush();
    expect(calls.length).toBe(made);
    player.halt();
  });

  it('reports a dry buffer, then restarts the timeline just after now when audio arrives late', async () => {
    const { player, audio, events } = setup(2);
    const { engine, finish } = gated();
    player.start(engine, 0);
    await flush();
    audio.currentTime = 2;
    await flush();
    expect(events.buffering).toHaveBeenCalledWith(true);
    finish(0);
    await flush();
    expect(audio.starts).toHaveLength(1);
    // Scheduled after "now" (2 s), not in the past.
    expect(audio.starts[0]?.at).toBeGreaterThan(2);
    expect(audio.starts[0]?.at).toBeLessThan(2.1);
    expect(events.buffering).toHaveBeenLastCalledWith(false);
    player.halt();
  });
});
