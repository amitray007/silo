// biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: throwaway prototype
import { useCallback, useEffect, useRef, useState } from 'react';
import { buildUnits, stretch, type Unit } from './speechPlan.prototype';
import {
  createEngine,
  ENGINES,
  type EngineId,
  type TtsEngine,
  type Voice,
} from './ttsEngine.prototype';
import { BLOCK_SELECTOR, proseTextNodes, scrollToRange } from './useProseRoot';

export type Segment = {
  id: number;
  /** What the voice says. */
  text: string;
  /** What the highlight covers. */
  range: Range;
  block: Element;
  kind: 'heading' | 'text';
  /** Silence after the segment, in ms. */
  pause: number;
};

export const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;

const highlightSupported =
  typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined';

type Piece = { node: Text; start: number };

function pointAt(pieces: Piece[], offset: number, end: boolean): [Text, number] {
  for (let i = pieces.length - 1; i >= 0; i -= 1) {
    const piece = pieces[i];
    if (!piece) continue;
    const length = piece.node.data.length;
    if (offset > piece.start || (!end && offset === piece.start))
      if (offset <= piece.start + length) return [piece.node, offset - piece.start];
  }
  const first = pieces[0];
  return [first?.node as Text, 0];
}

/**
 * Turn the prose DOM into speakable sentences. Headings get a pause, list items read as plain
 * sentences, and code, figures, captions and tables are skipped.
 */
export function buildSegments(root: HTMLElement): Segment[] {
  const groups = new Map<Element, Text[]>();
  for (const node of proseTextNodes(root)) {
    if (node.parentElement?.closest('figcaption')) continue;
    const block = node.parentElement?.closest(BLOCK_SELECTOR) ?? root;
    const list = groups.get(block) ?? [];
    list.push(node);
    groups.set(block, list);
  }
  const segmenter = new Intl.Segmenter(document.documentElement.lang || 'en', {
    granularity: 'sentence',
  });
  const segments: Segment[] = [];
  for (const [block, nodes] of groups) {
    const pieces: Piece[] = [];
    let text = '';
    for (const node of nodes) {
      pieces.push({ node, start: text.length });
      text += node.data;
    }
    const heading = /^H[1-6]$/.test(block.tagName);
    for (const part of segmenter.segment(text)) {
      const spoken = part.segment.replace(/\s+/g, ' ').trim();
      if (!/[\p{L}\p{N}]/u.test(spoken)) continue;
      const startOffset = part.index + (part.segment.length - part.segment.trimStart().length);
      const endOffset = part.index + part.segment.trimEnd().length;
      const range = document.createRange();
      const [startNode, startPos] = pointAt(pieces, startOffset, false);
      const [endNode, endPos] = pointAt(pieces, endOffset, true);
      range.setStart(startNode, startPos);
      range.setEnd(endNode, endPos);
      segments.push({
        id: segments.length,
        text: /[.!?…:;]$/.test(spoken) ? spoken : `${spoken}.`,
        range,
        block,
        kind: heading ? 'heading' : 'text',
        pause: heading ? 750 : 0,
      });
    }
    const last = segments.at(-1);
    if (last && !heading && last.block === block) last.pause = 250;
  }
  return segments;
}

type Status = 'idle' | 'loading' | 'ready' | 'error';
export type SpeechStats = {
  loadMs?: number;
  firstAudioMs?: number;
  device?: string;
};

/** Synthesized audio for one unit. Chunks arrive while the unit is still being generated. */
type Job = {
  key: string;
  chunks: Float32Array[];
  sampleRate: number;
  done: boolean;
  failed: string;
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

const LOOKAHEAD_SECONDS = 20;
const LOOKAHEAD_UNITS = 3;
const MAX_AHEAD = 12;
const CACHE_LIMIT = 90;
const CHARS_PER_SECOND = 15;

function seconds(job: Job): number {
  let samples = 0;
  for (const chunk of job.chunks) samples += chunk.length;
  return samples / job.sampleRate;
}

/**
 * Read aloud with an in-browser TTS model. Units are synthesized ahead in order, scheduled on the
 * AudioContext timeline so playback is gapless, and cached so going back is instant.
 */
export function useReadAloud(root: HTMLElement | null, scroll: HTMLElement | null) {
  const [active, setActive] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [index, setIndex] = useState(0);
  const [rate, setRateState] = useState(1);
  const [engineId, setEngineIdState] = useState<EngineId>('kokoro');
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voiceId, setVoiceIdState] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [progress, setProgress] = useState<number | null>(null);
  const [bytes, setBytes] = useState({ loaded: 0, total: 0 });
  const [error, setError] = useState('');
  const [stats, setStats] = useState<SpeechStats>({});
  const [buffering, setBuffering] = useState(false);
  const lastClick = useRef<Node | null>(null);
  const begun = useRef(false);
  const engines = useRef(new Map<EngineId, TtsEngine>());
  const loading = useRef(new Map<EngineId, Promise<TtsEngine>>());
  const context = useRef<AudioContext>(undefined);
  const pressedAt = useRef(0);
  const live = useRef({
    index: 0,
    rate: 1,
    voiceId: '',
    playing: false,
    engineId: 'kokoro' as EngineId,
  });
  live.current = { index, rate, voiceId, playing, engineId };

  // Playback state. `gen` invalidates everything scheduled before a stop or jump.
  const gen = useRef(0);
  const plan = useRef<{ units: Unit[]; jobs: Job[]; scheduled: number[]; unitStart: number[] }>({
    units: [],
    jobs: [],
    scheduled: [],
    unitStart: [],
  });
  const cursor = useRef({ unit: 0, requested: 0, nextTime: 0 });
  const timeline = useRef<{ at: number; seg: number }[]>([]);
  const sources = useRef<AudioBufferSourceNode[]>([]);
  const shown = useRef(-1);
  const ticker = useRef<number>(0);
  const cache = useRef(new Map<string, Job>());
  const queue = useRef<Queued[]>([]);
  const running = useRef<{ job: Job; abort: AbortController } | null>(null);
  const stretched = useRef(new Map<string, Float32Array>());

  const [segments, setSegments] = useState<Segment[]>([]);
  const segmentsRef = useRef<Segment[]>([]);
  const ensure = useCallback(() => {
    if (!segmentsRef.current.length && root) {
      segmentsRef.current = buildSegments(root);
      setSegments(segmentsRef.current);
    }
    return segmentsRef.current;
  }, [root]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: new prose invalidates the sentences.
  useEffect(() => {
    segmentsRef.current = [];
    setSegments([]);
    setIndex(0);
    begun.current = false;
  }, [root]);

  useEffect(() => {
    if (!root) return;
    const remember = (event: MouseEvent) => {
      lastClick.current = event.target as Node;
    };
    root.addEventListener('mousedown', remember);
    return () => root.removeEventListener('mousedown', remember);
  }, [root]);

  const markSentence = useCallback(
    (segment: Segment | undefined) => {
      if (highlightSupported) {
        if (segment) CSS.highlights.set('proto-speak', new Highlight(segment.range));
        else CSS.highlights.delete('proto-speak');
      }
      if (!segment || !scroll) return;
      const rect = segment.range.getBoundingClientRect();
      const box = scroll.getBoundingClientRect();
      if (rect.top < box.top + 70 || rect.bottom > box.bottom - 120)
        scrollToRange(scroll, segment.range);
    },
    [scroll],
  );

  const loadEngine = useCallback((id: EngineId): Promise<TtsEngine> => {
    const ready = engines.current.get(id);
    if (ready) return Promise.resolve(ready);
    const pending = loading.current.get(id);
    if (pending) return pending;
    const engine = createEngine(id);
    const started = performance.now();
    setStatus('loading');
    setProgress(null);
    setError('');
    // Ask the browser to keep the cached model.
    void navigator.storage?.persist?.();
    const promise = engine
      .load((percent, loaded, total) => {
        setProgress(percent);
        setBytes({ loaded, total });
      })
      .then(() => {
        engines.current.set(id, engine);
        if (live.current.engineId === id) {
          setStatus('ready');
          setVoices(engine.voices());
        }
        setStats((current) => ({
          ...current,
          loadMs: Math.round(performance.now() - started),
          device: engine.device,
        }));
        return engine;
      })
      .catch((reason: unknown) => {
        loading.current.delete(id);
        setStatus('error');
        setError(reason instanceof Error ? reason.message : String(reason));
        throw reason;
      });
    loading.current.set(id, promise);
    return promise;
  }, []);

  // ---- Synthesis queue: one job at a time, lowest priority number first. ----
  const runQueue = useCallback(async () => {
    if (running.current) return;
    for (;;) {
      queue.current.sort((a, b) => a.priority - b.priority);
      const next = queue.current.shift();
      if (!next) return;
      const abort = new AbortController();
      running.current = { job: next.job, abort };
      try {
        for await (const chunk of next.engine.stream(next.text, {
          voice: next.voice,
          speed: next.speed,
          signal: abort.signal,
        })) {
          next.job.chunks.push(chunk);
          next.job.sampleRate = next.engine.sampleRate;
          for (const listener of next.job.listeners) listener();
        }
        if (!abort.signal.aborted) next.job.done = true;
      } catch (reason) {
        next.job.failed = reason instanceof Error ? reason.message : String(reason);
      }
      running.current = null;
      if (next.job.done) {
        cache.current.set(next.job.key, next.job);
        if (cache.current.size > CACHE_LIMIT)
          cache.current.delete(cache.current.keys().next().value as string);
      }
      for (const listener of next.job.listeners) listener();
    }
  }, []);

  const inflight = useRef(new Map<string, Job>());
  const jobFor = useCallback(
    (engine: TtsEngine, text: string, priority: number): Job => {
      const speed = engine.supportsSpeed ? live.current.rate : 1;
      const key = `${engine.id}|${live.current.voiceId}|${speed}|${text}`;
      const hit = cache.current.get(key) ?? inflight.current.get(key);
      if (hit) {
        const waiting = queue.current.find((entry) => entry.job === hit);
        if (waiting && priority < waiting.priority) waiting.priority = priority;
        return hit;
      }
      const job: Job = {
        key,
        chunks: [],
        sampleRate: engine.sampleRate,
        done: false,
        failed: '',
        listeners: new Set(),
      };
      inflight.current.set(key, job);
      job.listeners.add(() => {
        if (job.done || job.failed) inflight.current.delete(key);
      });
      queue.current.push({ job, text, priority, speed, voice: live.current.voiceId, engine });
      void runQueue();
      return job;
    },
    [runQueue],
  );

  /** Drop pending synthesis and stop what is playing; the running Phonon stream is aborted. */
  const halt = useCallback(() => {
    gen.current += 1;
    cancelAnimationFrame(ticker.current);
    clearInterval(ticker.current);
    for (const entry of queue.current) inflight.current.delete(entry.job.key);
    queue.current = [];
    running.current?.abort.abort();
    for (const node of sources.current) {
      node.onended = null;
      try {
        node.stop();
      } catch {
        /* Already stopped. */
      }
    }
    sources.current = [];
    timeline.current = [];
    shown.current = -1;
  }, []);

  // ---- Scheduling on the AudioContext timeline. ----
  const scheduleBuffer = useCallback((pcm: Float32Array, sampleRate: number): number => {
    const audio = context.current as AudioContext;
    const buffer = audio.createBuffer(1, pcm.length, sampleRate);
    buffer.getChannelData(0).set(pcm);
    const node = audio.createBufferSource();
    node.buffer = buffer;
    node.connect(audio.destination);
    // An underrun (audio not ready in time) restarts the timeline just after "now".
    const at = Math.max(cursor.current.nextTime, audio.currentTime + 0.02);
    node.start(at);
    sources.current.push(node);
    node.onended = () => {
      sources.current = sources.current.filter((entry) => entry !== node);
    };
    cursor.current.nextTime = at + buffer.duration;
    if (pressedAt.current) {
      const first = Math.round(performance.now() - pressedAt.current);
      pressedAt.current = 0;
      setStats((previous) => ({ ...previous, firstAudioMs: first }));
    }
    return at;
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: finishUnit and pump are declared below and only use refs.
  const step = useCallback(() => {
    const audio = context.current;
    const p = plan.current;
    const engine = engines.current.get(live.current.engineId);
    if (!audio || !engine) return;
    for (;;) {
      const u = cursor.current.unit;
      const job = p.jobs[u];
      const unit = p.units[u];
      if (!job || !unit) break;
      if (job.failed) {
        setStatus('error');
        setError(job.failed);
        setPlaying(false);
        halt();
        return;
      }
      const sendWhole = !engine.supportsSpeed && Math.abs(live.current.rate - 1) > 0.01;
      const have = p.scheduled[u] ?? 0;
      if (sendWhole) {
        // Pitch-preserving speed needs the whole unit, so it does not stream.
        if (!job.done) break;
        const total = new Float32Array(job.chunks.reduce((sum, chunk) => sum + chunk.length, 0));
        let offset = 0;
        for (const chunk of job.chunks) {
          total.set(chunk, offset);
          offset += chunk.length;
        }
        const memo = `${job.key}|${live.current.rate}`;
        const cached = stretched.current.get(memo);
        const fast = cached ?? stretch(total, live.current.rate);
        if (!cached) {
          stretched.current.set(memo, fast);
          if (stretched.current.size > 40)
            stretched.current.delete(stretched.current.keys().next().value as string);
        }
        p.unitStart[u] = scheduleBuffer(fast, job.sampleRate);
        p.scheduled[u] = job.chunks.length;
        finishUnit(u, fast.length / job.sampleRate);
        continue;
      }
      while ((p.scheduled[u] ?? 0) < job.chunks.length) {
        const at = scheduleBuffer(job.chunks[p.scheduled[u] ?? 0] as Float32Array, job.sampleRate);
        if ((p.scheduled[u] ?? 0) === 0) p.unitStart[u] = at;
        p.scheduled[u] = (p.scheduled[u] ?? 0) + 1;
      }
      if (job.done && (p.scheduled[u] ?? 0) === job.chunks.length && have >= 0) {
        finishUnit(u, seconds(job));
        continue;
      }
      break;
    }
    pump();
  }, [halt, scheduleBuffer]);

  const finishUnit = (u: number, duration: number) => {
    const p = plan.current;
    const unit = p.units[u];
    const start = p.unitStart[u] ?? cursor.current.nextTime;
    if (!unit) return;
    // Spread the unit's sentences over its duration by text share.
    const total =
      unit.parts.reduce((sum: number, part: { chars: number }) => sum + part.chars, 0) || 1;
    let before = 0;
    for (const part of unit.parts) {
      timeline.current.push({ at: start + (duration * before) / total, seg: part.seg });
      before += part.chars;
    }
    cursor.current.nextTime += unit.pause / 1000;
    cursor.current.unit = u + 1;
  };

  const pump = () => {
    const audio = context.current;
    const engine = engines.current.get(live.current.engineId);
    const p = plan.current;
    if (!audio || !engine) return;
    const now = audio.currentTime;
    let playing = p.unitStart.findLastIndex((start) => start !== undefined && start <= now);
    if (playing < 0) playing = 0;
    for (;;) {
      const next = cursor.current.requested;
      if (next >= p.units.length || next - playing > MAX_AHEAD) break;
      let ahead = 0;
      for (let i = playing; i < next; i += 1) {
        const job = p.jobs[i];
        const unit = p.units[i];
        if (!job || !unit) continue;
        ahead += job.done ? seconds(job) : unit.text.length / CHARS_PER_SECOND / live.current.rate;
      }
      if (ahead >= LOOKAHEAD_SECONDS && next - playing >= LOOKAHEAD_UNITS) break;
      const unit = p.units[next] as Unit;
      const job = jobFor(engine, unit.text, next);
      job.listeners.add(() => wakeRef.current());
      p.jobs[next] = job;
      cursor.current.requested = next + 1;
    }
  };

  // Queue listeners call the latest step.
  const wakeRef = useRef<() => void>(() => {});
  wakeRef.current = step;

  const tick = useCallback(() => {
    const audio = context.current;
    if (!audio) return;
    step();
    const now = audio.currentTime;
    let seg = -1;
    for (const entry of timeline.current) if (entry.at <= now) seg = entry.seg;
    if (seg >= 0 && seg !== shown.current) {
      shown.current = seg;
      setIndex(seg);
      markSentence(segmentsRef.current[seg]);
    }
    const finished =
      cursor.current.unit >= plan.current.units.length && cursor.current.nextTime <= now;
    setBuffering(!finished && cursor.current.nextTime - now < 0.03);
    if (finished) {
      setPlaying(false);
      setBuffering(false);
      markSentence(undefined);
      begun.current = false;
      halt();
    }
  }, [step, markSentence, halt]);

  const startAt = useCallback(
    async (from: number) => {
      pressedAt.current = pressedAt.current || performance.now();
      halt();
      const token = gen.current;
      const list = ensure();
      setActive(true);
      if (!list[from]) {
        setPlaying(false);
        return;
      }
      setPlaying(true);
      begun.current = true;
      setIndex(from);
      markSentence(list[from]);
      context.current ??= new AudioContext();
      const audio = context.current;
      if (audio.state === 'suspended') void audio.resume();
      (window as unknown as { __protoAudio?: AudioContext }).__protoAudio = audio;
      let engine: TtsEngine;
      try {
        engine = await loadEngine(live.current.engineId);
      } catch {
        setPlaying(false);
        return;
      }
      if (token !== gen.current) return;
      plan.current = { units: buildUnits(list, from), jobs: [], scheduled: [], unitStart: [] };
      cursor.current = { unit: 0, requested: 0, nextTime: audio.currentTime + 0.03 };
      stretched.current.clear();
      for (const entry of [...plan.current.units.keys()].slice(0, 1)) {
        const unit = plan.current.units[entry] as Unit;
        const job = jobFor(engine, unit.text, -1);
        job.listeners.add(() => wakeRef.current());
        plan.current.jobs[entry] = job;
        cursor.current.requested = entry + 1;
      }
      clearInterval(ticker.current);
      ticker.current = window.setInterval(() => {
        if (token === gen.current) tick();
      }, 40);
      tick();
    },
    [halt, ensure, markSentence, loadEngine, jobFor, tick],
  );

  const firstVisible = useCallback(() => {
    if (!scroll) return 0;
    const top = scroll.getBoundingClientRect().top + 60;
    const found = ensure().findIndex((segment) => segment.range.getBoundingClientRect().top >= top);
    return Math.max(0, found);
  }, [scroll, ensure]);

  // Warm up: load the model, then synthesize the first sentence so Play is instant.
  const warm = useCallback(async () => {
    try {
      const engine = await loadEngine(live.current.engineId);
      const list = ensure();
      const units = buildUnits(list, Math.min(list.length - 1, firstVisible()));
      for (const unit of units.slice(0, 2)) jobFor(engine, unit.text, 100);
    } catch {
      /* The error state is already set. */
    }
  }, [loadEngine, ensure, firstVisible, jobFor]);

  const startHere = useCallback(() => {
    const list = ensure();
    const selection = window.getSelection();
    let node: Node | null = null;
    if (selection && !selection.isCollapsed && root?.contains(selection.anchorNode))
      node = selection.anchorNode;
    else if (lastClick.current && root?.contains(lastClick.current)) node = lastClick.current;
    const found = node
      ? list.findIndex(
          (segment) => segment.range.intersectsNode(node as Node) || segment.block.contains(node),
        )
      : -1;
    pressedAt.current = performance.now();
    void startAt(found >= 0 ? found : firstVisible());
  }, [root, startAt, firstVisible, ensure]);

  const play = useCallback(() => {
    pressedAt.current = performance.now();
    void startAt(begun.current ? live.current.index : firstVisible());
  }, [startAt, firstVisible]);

  const pause = useCallback(() => {
    halt();
    setPlaying(false);
    setBuffering(false);
  }, [halt]);

  const stop = useCallback(() => {
    halt();
    setPlaying(false);
    setActive(false);
    setBuffering(false);
    begun.current = false;
    markSentence(undefined);
  }, [halt, markSentence]);

  const jump = useCallback(
    (at: number) => {
      const next = Math.min(segmentsRef.current.length - 1, Math.max(0, at));
      if (live.current.playing) {
        pressedAt.current = performance.now();
        void startAt(next);
      } else {
        setIndex(next);
        markSentence(segmentsRef.current[next]);
      }
    },
    [startAt, markSentence],
  );

  const restartIfPlaying = useCallback(() => {
    if (live.current.playing) void startAt(live.current.index);
  }, [startAt]);

  const setRate = useCallback(
    (value: number) => {
      setRateState(value);
      live.current.rate = value;
      restartIfPlaying();
      // A new speed needs fresh audio on engines with native speed, so warm it before Play.
      if (!live.current.playing) void warm();
    },
    [restartIfPlaying, warm],
  );

  const chooseVoice = useCallback(
    (id: string) => {
      setVoiceIdState(id);
      live.current.voiceId = id;
      restartIfPlaying();
    },
    [restartIfPlaying],
  );

  const chooseEngine = useCallback(
    (id: EngineId) => {
      halt();
      setPlaying(false);
      setEngineIdState(id);
      live.current.engineId = id;
      live.current.voiceId = '';
      setVoiceIdState('');
      const ready = engines.current.get(id);
      setVoices(ready ? ready.voices() : []);
      setStatus(ready ? 'ready' : 'idle');
      setError('');
      void warm();
    },
    [halt, warm],
  );

  useEffect(() => {
    const map = engines.current;
    return () => {
      gen.current += 1;
      clearInterval(ticker.current);
      for (const node of sources.current) {
        try {
          node.stop();
        } catch {
          /* Already stopped. */
        }
      }
      void context.current?.close();
      for (const engine of map.values()) engine.dispose();
      map.clear();
      if (highlightSupported) CSS.highlights.delete('proto-speak');
    };
  }, []);

  return {
    active,
    playing,
    segments,
    index,
    current: segments[index],
    rate,
    setRate,
    engineId,
    engines: ENGINES,
    setEngine: chooseEngine,
    voices,
    voiceId,
    setVoiceId: chooseVoice,
    status,
    progress,
    bytes,
    error,
    stats,
    buffering,
    retry: () => {
      setStatus('idle');
      setError('');
      play();
    },
    open: () => {
      ensure();
      setActive(true);
      void warm();
    },
    toggle: () => (playing ? pause() : play()),
    play,
    pause,
    stop,
    next: () => jump(index + 1),
    prev: () => jump(index - 1),
    jump,
    startHere,
    startAt: (at: number) => {
      pressedAt.current = performance.now();
      void startAt(at);
    },
    slower: () => {
      const i = RATES.findIndex((value) => value >= rate);
      setRate(RATES[Math.max(0, i - 1)] ?? 1);
    },
    faster: () => {
      const i = RATES.findIndex((value) => value > rate);
      setRate(RATES[i < 0 ? RATES.length - 1 : i] ?? 1);
    },
  };
}

export type ReadAloudApi = ReturnType<typeof useReadAloud>;

/** The one-line state shown next to the player controls. */
export function engineStatusLine(ra: ReadAloudApi): string | null {
  if (ra.status === 'loading')
    return ra.progress === null ? 'Downloading voice...' : `Downloading voice · ${ra.progress}%`;
  if (ra.status === 'error') return `Voice failed: ${ra.error}`;
  return null;
}
