import type { ReadAloudPauses } from '../../../lib/readerPrefs';
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
import { StretchProcessor } from './stretchProcessor';
import { type Job, jobKey, jobSeconds, SynthQueue } from './synthQueue';

/** How often the player checks its audio clock. */
const TICK_MS = 40;
/** Priority of the unit the reader asked for; warm-up work waits behind everything. */
const NOW = -1;
const WARM = 100;
const WARM_UNITS = 2;

type PlayerSettings = { rate: number; voice: string; pauses: ReadAloudPauses };

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
  transform?: Pick<StretchProcessor, 'process' | 'cancel'>;
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
  /** Timeline offset of the unit currently being scheduled. */
  private unitTimelineStart = 0;
  private sources: AudioBufferSourceNode[] = [];
  private shown = -1;
  private timer: ReturnType<typeof setInterval> | undefined;
  private pressedAt = 0;
  private waiting = false;
  /** Samples to fade after cutting overdue held silence. */
  private fadeRemaining = 0;
  private silenceSkipUntil = 0;
  /** Units before this index have played and let go of their audio. */
  private released = 0;
  private readonly transform: Pick<StretchProcessor, 'process' | 'cancel'>;
  private readonly transforming = new Set<string>();
  private readonly subscriptions = new Map<Job, () => void>();

  constructor(
    private readonly deps: PlayerDeps,
    cache = new ReplayCache(),
  ) {
    this.queue = new SynthQueue(cache);
    this.transform = deps.transform ?? new StretchProcessor();
  }

  private get clock(): number {
    return (this.deps.now ?? performance.now.bind(performance))();
  }

  /** Mark the moment the reader asked for sound, for the time-to-first-audio figure. */
  press(): void {
    this.pressedAt ||= this.clock;
  }

  /** Start speaking at a sentence with a loaded engine. */
  start(engine: TtsEngine, from: number, prepared?: Unit[]): void {
    this.press();
    const units = prepared ?? buildUnits(this.deps.segments(), from, this.deps.settings().pauses);
    this.prepare(engine, from, units);
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

  /** Choose useful synthesis keys before stopping sound or clearing any work. */
  prepare(engine: TtsEngine | undefined, from: number, units?: Unit[]): Unit[] {
    const { rate, voice, pauses } = this.deps.settings();
    const target = units ?? buildUnits(this.deps.segments(), from, pauses);
    const keep = new Set<string>();
    if (engine) {
      const speed = engine.supportsSpeed ? rate : 1;
      let seconds = 0;
      for (const unit of target) {
        if (keep.size >= this.aheadLimit(engine) || aheadEnough(seconds, keep.size)) break;
        keep.add(jobKey(engine, voice, speed, unit.text, pauses !== 'natural'));
        seconds += unit.text.length / CHARS_PER_SECOND / rate;
      }
    }
    this.halt(true, keep);
    return target;
  }

  /** Whole-waveform synthesis cannot be interrupted; keep only the current and next unit. */
  private aheadLimit(engine = this.engine): number {
    return engine?.id === 'kokoro' ? WARM_UNITS : MAX_AHEAD + 1;
  }

  /** Synthesize the first units from a sentence now, so Play later is instant. */
  warm(engine: TtsEngine, from: number): void {
    const { rate, voice, pauses } = this.deps.settings();
    const speed = engine.supportsSpeed ? rate : 1;
    const units = this.prepare(engine, from);
    for (const unit of units.slice(0, WARM_UNITS)) {
      this.queue.request(engine, unit.text, voice, speed, WARM, pauses !== 'natural');
    }
  }

  /** Stop what is playing and drop stale work. `keepPress` keeps the time-to-first-audio clock. */
  halt(keepPress = false, keep?: ReadonlySet<string>): void {
    this.generation += 1;
    this.active = false;
    clearInterval(this.timer);
    this.queue.clear(keep);
    this.transform.cancel();
    this.transforming.clear();
    for (const [job, listener] of this.subscriptions) job.listeners.delete(listener);
    this.subscriptions.clear();
    for (const node of this.sources) {
      node.onended = null;
      try {
        node.stop();
      } catch {
        // Already stopped.
      }
    }
    this.silenceSkipUntil = 0;
    this.fadeRemaining = 0;
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
    const { rate, voice, pauses } = this.deps.settings();
    const job = this.queue.request(
      engine,
      unit.text,
      voice,
      engine.supportsSpeed ? rate : 1,
      priority,
      pauses !== 'natural',
    );
    const token = this.generation;
    const ready = () => {
      if (token !== this.generation) return;
      this.prepareAudio(job);
      this.step();
    };
    if (!this.subscriptions.has(job)) {
      job.listeners.add(ready);
      this.subscriptions.set(job, ready);
    }
    this.plan.jobs[index] = job;
    this.prepareAudio(job);
    this.cursor.requested = index + 1;
  }

  /** Transform lookahead as soon as synthesis finishes, before it reaches the audio deadline. */
  private prepareAudio(job: Job): void {
    const { rate } = this.deps.settings();
    if (!job.done || this.engine?.supportsSpeed || Math.abs(rate - 1) <= 0.01) return;
    const key = `${job.key}|x${rate}`;
    if (this.queue.cache.get(key) || this.transforming.has(key)) return;
    this.transforming.add(key);
    const token = this.generation;
    void this.transform.process(job.chunks, rate).then(
      (pcm) => {
        if (token !== this.generation) return;
        this.transforming.delete(key);
        this.queue.cache.set(key, { chunks: [pcm], sampleRate: job.sampleRate });
        this.step();
      },
      (reason: unknown) => {
        if (token !== this.generation) return;
        this.transforming.delete(key);
        this.halt();
        this.deps.events.failed(reason instanceof Error ? reason.message : String(reason));
      },
    );
  }

  private schedule(pcm: Float32Array, sampleRate: number, silence = false): number {
    const audio = this.deps.context();
    if (silence && this.cursor.nextTime < audio.currentTime)
      // Include the restart lead: it is heard as part of the underrun too.
      this.silenceSkipUntil = startTime(this.cursor.nextTime, audio.currentTime);
    if (silence && this.cursor.nextTime < this.silenceSkipUntil) {
      const overdue = this.silenceSkipUntil - this.cursor.nextTime;
      const skip = Math.min(pcm.length, Math.ceil(overdue * sampleRate));
      pcm = pcm.subarray(skip);
      this.cursor.nextTime += skip / sampleRate;
      this.fadeRemaining = Math.max(2, Math.round(sampleRate * 0.005));
    }
    if (!pcm.length) return this.cursor.nextTime;
    this.silenceSkipUntil = 0;
    if (this.fadeRemaining) {
      const fade = Math.max(2, Math.round(sampleRate * 0.005));
      const count = Math.min(pcm.length, this.fadeRemaining);
      pcm = pcm.slice();
      for (let i = 0; i < count; i += 1)
        pcm[i] = ((pcm[i] ?? 0) * (fade - this.fadeRemaining + i)) / (fade - 1);
      this.fadeRemaining -= count;
    }
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
    this.trackSentences(index, duration);
    this.cursor.nextTime += unit.pause / 1000 / this.deps.settings().rate;
    this.cursor.unit = index + 1;
  }

  private beginUnit(index: number, at: number): void {
    this.plan.unitStart[index] = at;
    this.unitTimelineStart = this.timeline.length;
    const first = this.plan.units[index]?.parts[0];
    if (first) this.timeline.push({ at, seg: first.seg });
  }

  /** Replace this unit's estimates; later units have not been scheduled yet. */
  private trackSentences(index: number, duration: number, until = Infinity): void {
    const unit = this.plan.units[index];
    const start = this.plan.unitStart[index];
    if (!unit || unit.parts.length < 2 || start === undefined) return;
    this.timeline.splice(
      this.unitTimelineStart + 1,
      this.timeline.length,
      ...sentenceTimes(unit, start, duration)
        .slice(1)
        .filter((entry) => entry.at <= until),
    );
  }

  private scheduleStretched(index: number, job: Job, rate: number): boolean {
    if (!job.done) return false;
    const pcm = this.queue.cache.get(`${job.key}|x${rate}`)?.chunks[0];
    if (!pcm) {
      this.prepareAudio(job);
      return false;
    }
    this.beginUnit(index, this.schedule(pcm, job.sampleRate));
    this.finishUnit(index, pcm.length / job.sampleRate);
    return true;
  }

  /** Schedule a unit's audio that is ready. Returns true when the unit is fully scheduled. */
  private scheduleUnit(u: number, job: Job, stretching: boolean, rate: number): boolean {
    const { plan } = this;
    if (stretching) return this.scheduleStretched(u, job, rate);
    while ((plan.scheduled[u] ?? 0) < job.chunks.length) {
      const chunk = plan.scheduled[u] ?? 0;
      const at = this.schedule(
        job.chunks[chunk] as Float32Array,
        job.sampleRate,
        job.heldSilence.has(chunk),
      );
      if (!plan.scheduled[u]) this.beginUnit(u, at);
      plan.scheduled[u] = (plan.scheduled[u] ?? 0) + 1;
    }
    if (!job.done || plan.scheduled[u] !== job.chunks.length) {
      const unit = plan.units[u];
      if (unit)
        this.trackSentences(u, unit.text.length / CHARS_PER_SECOND / rate, this.cursor.nextTime);
      return false;
    }
    this.finishUnit(u, this.cursor.nextTime - (plan.unitStart[u] ?? this.cursor.nextTime));
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
    for (; this.released < playing; this.released += 1) {
      const job = plan.jobs[this.released];
      const listener = job && this.subscriptions.get(job);
      if (job && listener) {
        job.listeners.delete(listener);
        this.subscriptions.delete(job);
      }
      plan.jobs[this.released] = undefined;
    }
    for (;;) {
      const next = cursor.requested;
      if (next >= plan.units.length || next - playing >= this.aheadLimit()) break;
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
