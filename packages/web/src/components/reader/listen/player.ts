import type { TtsEngine } from './engines/types';
import { ReplayCache } from './replayCache';
import {
  aheadEnough,
  CHARS_PER_SECOND,
  MAX_AHEAD,
  sentenceAtTime,
  sentenceTimes,
  startTime,
} from './schedule';
import type { Segment } from './segments';
import { buildUnits, type Unit } from './speechPlan';
import { stretch } from './stretch';
import { type Job, jobKey, jobSeconds, SynthQueue } from './synthQueue';

/** How often the player checks its audio clock. */
const TICK_MS = 40;
/** Priority of the unit the reader asked for; warm-up work waits behind everything. */
const NOW = -1;
const WARM = 100;
const WARM_UNITS = 2;

type PlayerSettings = { rate: number; voice: string };

export type PlayerEvents = {
  /** The sentence being spoken changed. */
  sentence(index: number): void;
  /** Playback ran dry (`true`) or recovered (`false`). */
  buffering(waiting: boolean): void;
  /** The last unit finished. */
  finished(): void;
  /** A unit failed to synthesize. */
  failed(message: string): void;
  /** Milliseconds from `start` to the first scheduled sample. */
  firstAudio(ms: number): void;
};

export type PlayerDeps = {
  context: () => AudioContext;
  segments: () => readonly Segment[];
  settings: () => PlayerSettings;
  events: PlayerEvents;
  now?: () => number;
};

type Plan = {
  units: Unit[];
  /** A unit's job, until the unit has played: the replay cache keeps the audio after that. */
  jobs: (Job | undefined)[];
  scheduled: number[];
  unitStart: number[];
};

/**
 * Plays synthesized units gapless: each unit's buffers are scheduled on the `AudioContext`
 * timeline right after the last one, a lookahead queue keeps about 20 seconds synthesized
 * ahead, and `halt` (a jump, or a voice, engine or speed change) cancels everything stale.
 */
export class Player {
  readonly queue: SynthQueue;
  private generation = 0;
  private active = false;
  private engine: TtsEngine | undefined;
  private plan: Plan = { units: [], jobs: [], scheduled: [], unitStart: [] };
  private cursor = { unit: 0, requested: 0, nextTime: 0 };
  private timeline: { at: number; seg: number }[] = [];
  private sources: AudioBufferSourceNode[] = [];
  private shown = -1;
  private timer: ReturnType<typeof setInterval> | undefined;
  private pressedAt = 0;
  private waiting = false;
  /** Units before this index have played and let go of their audio. */
  private released = 0;

  constructor(
    private readonly deps: PlayerDeps,
    cache = new ReplayCache(),
  ) {
    this.queue = new SynthQueue(cache);
  }

  private get clock(): number {
    return (this.deps.now ?? performance.now.bind(performance))();
  }

  /** Mark the moment the reader asked for sound, for the time-to-first-audio figure. */
  press(): void {
    this.pressedAt ||= this.clock;
  }

  /** Start speaking at a sentence with a loaded engine. */
  start(engine: TtsEngine, from: number): void {
    this.press();
    const units = buildUnits(this.deps.segments(), from);
    // Warm-up work for these units is kept, so Play after a warm-up does not synthesize again.
    const { rate, voice } = this.deps.settings();
    const speed = engine.supportsSpeed ? rate : 1;
    const keep = new Set(
      units.slice(0, WARM_UNITS).map((u) => jobKey(engine, voice, speed, u.text)),
    );
    this.halt(true, keep);
    const token = this.generation;
    this.active = true;
    this.engine = engine;
    const audio = this.deps.context();
    if (audio.state === 'suspended') void audio.resume();
    this.plan = { units, jobs: [], scheduled: [], unitStart: [] };
    this.released = 0;
    this.cursor = { unit: 0, requested: 0, nextTime: audio.currentTime + 0.03 };
    this.request(0, NOW);
    this.timer = setInterval(() => {
      if (token === this.generation) this.tick();
    }, TICK_MS);
    this.tick();
  }

  /** Synthesize the first units from a sentence now, so Play later is instant. */
  warm(engine: TtsEngine, from: number): void {
    const { rate, voice } = this.deps.settings();
    const speed = engine.supportsSpeed ? rate : 1;
    for (const unit of buildUnits(this.deps.segments(), from).slice(0, WARM_UNITS)) {
      this.queue.request(engine, unit.text, voice, speed, WARM);
    }
  }

  /** Stop what is playing and drop stale work. `keepPress` keeps the time-to-first-audio clock. */
  halt(keepPress = false, keep?: ReadonlySet<string>): void {
    this.generation += 1;
    this.active = false;
    clearInterval(this.timer);
    this.queue.clear(keep);
    for (const node of this.sources) {
      node.onended = null;
      try {
        node.stop();
      } catch {
        // Already stopped.
      }
    }
    this.sources = [];
    this.timeline = [];
    this.shown = -1;
    if (!keepPress) this.pressedAt = 0;
    this.setWaiting(false);
  }

  private setWaiting(waiting: boolean): void {
    if (waiting === this.waiting) return;
    this.waiting = waiting;
    this.deps.events.buffering(waiting);
  }

  /** Ask for unit `index`'s audio. */
  private request(index: number, priority: number): void {
    const { engine } = this;
    const unit = this.plan.units[index];
    if (!engine || !unit) return;
    const { rate, voice } = this.deps.settings();
    const job = this.queue.request(
      engine,
      unit.text,
      voice,
      engine.supportsSpeed ? rate : 1,
      priority,
    );
    const token = this.generation;
    job.listeners.add(() => {
      if (token === this.generation) this.step();
    });
    this.plan.jobs[index] = job;
    this.cursor.requested = index + 1;
  }

  /** The unit's whole waveform, stretched to the current speed when the engine has no speed option. */
  private whole(job: Job, rate: number): Float32Array {
    const key = `${job.key}|x${rate}`;
    const cached = this.queue.cache.get(key)?.chunks[0];
    if (cached) return cached;
    const joined = new Float32Array(job.chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    let offset = 0;
    for (const chunk of job.chunks) {
      joined.set(chunk, offset);
      offset += chunk.length;
    }
    const fast = stretch(joined, rate);
    this.queue.cache.set(key, { chunks: [fast], sampleRate: job.sampleRate });
    return fast;
  }

  private schedule(pcm: Float32Array, sampleRate: number): number {
    const audio = this.deps.context();
    const buffer = audio.createBuffer(1, pcm.length, sampleRate);
    buffer.getChannelData(0).set(pcm);
    const node = audio.createBufferSource();
    node.buffer = buffer;
    node.connect(audio.destination);
    const at = startTime(this.cursor.nextTime, audio.currentTime);
    node.start(at);
    this.sources.push(node);
    node.onended = () => {
      this.sources = this.sources.filter((entry) => entry !== node);
    };
    this.cursor.nextTime = at + buffer.duration;
    if (this.pressedAt) {
      this.deps.events.firstAudio(Math.round(this.clock - this.pressedAt));
      this.pressedAt = 0;
    }
    return at;
  }

  private finishUnit(index: number, duration: number): void {
    const unit = this.plan.units[index];
    if (!unit) return;
    const start = this.plan.unitStart[index] ?? this.cursor.nextTime;
    this.timeline.push(...sentenceTimes(unit, start, duration));
    this.cursor.nextTime += unit.pause / 1000;
    this.cursor.unit = index + 1;
  }

  /** Schedule a unit's audio that is ready. Returns true when the unit is fully scheduled. */
  private scheduleUnit(u: number, job: Job, stretching: boolean, rate: number): boolean {
    const { plan } = this;
    if (stretching) {
      // Pitch-preserving speed needs the whole unit, so it does not stream.
      if (!job.done) return false;
      const pcm = this.whole(job, rate);
      plan.unitStart[u] = this.schedule(pcm, job.sampleRate);
      this.finishUnit(u, pcm.length / job.sampleRate);
      return true;
    }
    while ((plan.scheduled[u] ?? 0) < job.chunks.length) {
      const at = this.schedule(job.chunks[plan.scheduled[u] ?? 0] as Float32Array, job.sampleRate);
      if (!plan.scheduled[u]) plan.unitStart[u] = at;
      plan.scheduled[u] = (plan.scheduled[u] ?? 0) + 1;
    }
    if (!job.done || plan.scheduled[u] !== job.chunks.length) return false;
    this.finishUnit(u, jobSeconds(job));
    return true;
  }

  /** Schedule every unit whose audio is ready, in order, then top up the lookahead. */
  private step(): void {
    const { engine, plan } = this;
    if (!engine || !this.active) return;
    const { rate } = this.deps.settings();
    const stretching = !engine.supportsSpeed && Math.abs(rate - 1) > 0.01;
    for (;;) {
      const u = this.cursor.unit;
      const job = plan.jobs[u];
      if (!job || !plan.units[u]) break;
      if (job.failed) {
        const message = job.failed;
        this.halt();
        this.deps.events.failed(message);
        return;
      }
      if (!this.scheduleUnit(u, job, stretching, rate)) break;
    }
    this.pump();
  }

  /** Estimated seconds of audio in units `from` up to (not including) `to`. */
  private secondsAhead(from: number, to: number, rate: number): number {
    let seconds = 0;
    for (let i = from; i < to; i += 1) {
      const job = this.plan.jobs[i];
      const unit = this.plan.units[i];
      if (job && unit) {
        seconds += job.done ? jobSeconds(job) : unit.text.length / CHARS_PER_SECOND / rate;
      }
    }
    return seconds;
  }

  /** Request units until about 20 seconds (and at least 3 units) are ahead of the playing one. */
  private pump(): void {
    const audio = this.deps.context();
    const { plan, cursor } = this;
    const { rate } = this.deps.settings();
    const playing = Math.max(
      0,
      plan.unitStart.findLastIndex((start) => start !== undefined && start <= audio.currentTime),
    );
    // A unit that has played lets go of its audio; going back reads the replay cache.
    for (; this.released < playing; this.released += 1) plan.jobs[this.released] = undefined;
    for (;;) {
      const next = cursor.requested;
      if (next >= plan.units.length || next - playing > MAX_AHEAD) break;
      if (aheadEnough(this.secondsAhead(playing, next, rate), next - playing)) break;
      this.request(next, next);
    }
  }

  private tick(): void {
    const audio = this.deps.context();
    this.step();
    const seg = sentenceAtTime(this.timeline, audio.currentTime);
    if (seg >= 0 && seg !== this.shown) {
      this.shown = seg;
      this.deps.events.sentence(seg);
    }
    const finished =
      this.cursor.unit >= this.plan.units.length && this.cursor.nextTime <= audio.currentTime;
    this.setWaiting(!finished && this.cursor.nextTime - audio.currentTime < 0.03);
    if (finished) {
      this.halt();
      this.deps.events.finished();
    }
  }
}
