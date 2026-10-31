// biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: throwaway prototype
import { useCallback, useEffect, useRef, useState } from 'react';
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
type Clip = { pcm: Float32Array; sampleRate: number };
export type SpeechStats = {
  loadMs?: number;
  firstAudioMs?: number;
  device?: string;
};

async function collect(
  engine: TtsEngine,
  text: string,
  voice: string,
  speed: number,
): Promise<Clip> {
  const chunks: Float32Array[] = [];
  let length = 0;
  for await (const chunk of engine.stream(text, { voice, speed })) {
    chunks.push(chunk);
    length += chunk.length;
  }
  const pcm = new Float32Array(length);
  let at = 0;
  for (const chunk of chunks) {
    pcm.set(chunk, at);
    at += chunk.length;
  }
  return { pcm, sampleRate: engine.sampleRate };
}

/**
 * Read aloud with an in-browser TTS model: one sentence is synthesised at a time, the next is
 * prefetched while the current one plays, and the played sentence is highlighted.
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
  const [error, setError] = useState('');
  const [stats, setStats] = useState<SpeechStats>({});
  const [buffering, setBuffering] = useState(false);
  const generation = useRef(0);
  const lastClick = useRef<Node | null>(null);
  const begun = useRef(false);
  const engines = useRef(new Map<EngineId, TtsEngine>());
  const loading = useRef(new Map<EngineId, Promise<TtsEngine>>());
  const context = useRef<AudioContext>(undefined);
  const source = useRef<AudioBufferSourceNode>(undefined);
  const cache = useRef(new Map<string, Promise<Clip>>());
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const pressedAt = useRef(0);
  const live = useRef({
    index: 0,
    rate: 1,
    voiceId: '',
    playing: false,
    engineId: 'kokoro' as EngineId,
  });
  live.current = { index, rate, voiceId, playing, engineId };

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

  const stopAudio = useCallback(() => {
    generation.current += 1;
    const node = source.current;
    source.current = undefined;
    if (node) {
      node.onended = null;
      try {
        node.stop();
      } catch {
        /* Already stopped. */
      }
    }
  }, []);

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
    const promise = engine
      .load((percent) => setProgress(percent))
      .then(() => {
        engines.current.set(id, engine);
        setStatus('ready');
        setVoices(engine.voices());
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

  const clip = useCallback((engine: TtsEngine, at: number): Promise<Clip> | undefined => {
    const segment = segmentsRef.current[at];
    if (!segment) return undefined;
    const speed = engine.supportsSpeed ? live.current.rate : 1;
    const key = `${engine.id}|${live.current.voiceId}|${speed}|${at}`;
    let found = cache.current.get(key);
    if (!found) {
      // One synthesis at a time: Kokoro runs on the main thread, Phonon queues its own.
      found = queue.current.then(() => collect(engine, segment.text, live.current.voiceId, speed));
      queue.current = found.catch(() => undefined);
      cache.current.set(key, found);
      if (cache.current.size > 12)
        cache.current.delete(cache.current.keys().next().value as string);
    }
    return found;
  }, []);

  const speak = useCallback(
    async (from: number) => {
      stopAudio();
      const gen = generation.current;
      const list = ensure();
      if (!list[from]) {
        setPlaying(false);
        return;
      }
      begun.current = true;
      setIndex(from);
      markSentence(list[from]);
      context.current ??= new AudioContext();
      const audio = context.current;
      (window as unknown as { __protoAudio?: AudioContext }).__protoAudio = audio;
      if (audio.state === 'suspended') void audio.resume();
      let engine: TtsEngine;
      try {
        engine = await loadEngine(live.current.engineId);
      } catch {
        setPlaying(false);
        return;
      }
      if (gen !== generation.current) return;
      let at = from;
      while (gen === generation.current && list[at]) {
        const segment = list[at] as Segment;
        setIndex(at);
        markSentence(segment);
        const current = clip(engine, at);
        setBuffering(true);
        let data: Clip | undefined;
        try {
          data = await current;
        } catch (reason) {
          if (gen === generation.current) {
            setStatus('error');
            setError(reason instanceof Error ? reason.message : String(reason));
            setPlaying(false);
          }
          return;
        }
        setBuffering(false);
        if (gen !== generation.current || !data) return;
        clip(engine, at + 1); // Prefetch the next sentence while this one plays.
        const buffer = audio.createBuffer(1, data.pcm.length, data.sampleRate);
        buffer.getChannelData(0).set(data.pcm);
        const node = audio.createBufferSource();
        node.buffer = buffer;
        node.playbackRate.value = engine.supportsSpeed ? 1 : live.current.rate;
        node.connect(audio.destination);
        const finished = new Promise<void>((resolve) => {
          node.onended = () => resolve();
        });
        source.current = node;
        node.start();
        if (pressedAt.current) {
          const first = Math.round(performance.now() - pressedAt.current);
          pressedAt.current = 0;
          setStats((previous) => ({ ...previous, firstAudioMs: first }));
        }
        await finished;
        if (gen !== generation.current) return;
        if (segment.pause) await new Promise((resolve) => setTimeout(resolve, segment.pause));
        at += 1;
      }
      if (gen === generation.current) {
        setPlaying(false);
        markSentence(undefined);
      }
    },
    [stopAudio, ensure, markSentence, loadEngine, clip],
  );

  const startAt = useCallback(
    (at: number) => {
      pressedAt.current = performance.now();
      setActive(true);
      setPlaying(true);
      void speak(at);
    },
    [speak],
  );

  const firstVisible = useCallback(() => {
    if (!scroll) return 0;
    const top = scroll.getBoundingClientRect().top + 60;
    const found = ensure().findIndex((segment) => segment.range.getBoundingClientRect().top >= top);
    return Math.max(0, found);
  }, [scroll, ensure]);

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
    startAt(found >= 0 ? found : firstVisible());
  }, [root, startAt, firstVisible, ensure]);

  const play = useCallback(() => {
    startAt(begun.current ? live.current.index : firstVisible());
  }, [startAt, firstVisible]);

  const pause = useCallback(() => {
    stopAudio();
    setPlaying(false);
    setBuffering(false);
  }, [stopAudio]);

  const stop = useCallback(() => {
    stopAudio();
    setPlaying(false);
    setActive(false);
    setBuffering(false);
    begun.current = false;
    markSentence(undefined);
  }, [stopAudio, markSentence]);

  const jump = useCallback(
    (at: number) => {
      const next = Math.min(segmentsRef.current.length - 1, Math.max(0, at));
      if (live.current.playing) void speak(next);
      else {
        setIndex(next);
        markSentence(segmentsRef.current[next]);
      }
    },
    [speak, markSentence],
  );

  const restartIfPlaying = useCallback(() => {
    cache.current.clear();
    if (live.current.playing) void speak(live.current.index);
  }, [speak]);

  const setRate = useCallback(
    (value: number) => {
      setRateState(value);
      live.current.rate = value;
      // Engines with a speed option need new audio; others just change playbackRate.
      const engine = engines.current.get(live.current.engineId);
      if (source.current && engine && !engine.supportsSpeed)
        source.current.playbackRate.value = value;
      else restartIfPlaying();
    },
    [restartIfPlaying],
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
      stopAudio();
      setPlaying(false);
      setEngineIdState(id);
      live.current.engineId = id;
      live.current.voiceId = '';
      setVoiceIdState('');
      cache.current.clear();
      const ready = engines.current.get(id);
      setVoices(ready ? ready.voices() : []);
      setStatus(ready ? 'ready' : 'idle');
      setError('');
    },
    [stopAudio],
  );

  useEffect(() => {
    const map = engines.current;
    return () => {
      generation.current += 1;
      source.current?.stop?.();
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
    },
    toggle: () => (playing ? pause() : play()),
    play,
    pause,
    stop,
    next: () => jump(index + 1),
    prev: () => jump(index - 1),
    jump,
    startHere,
    startAt,
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
    return ra.progress === null
      ? 'Downloading voice model...'
      : `Downloading voice model ${ra.progress}%`;
  if (ra.status === 'error') return `Voice failed: ${ra.error}`;
  if (ra.buffering && ra.playing) return 'Preparing speech...';
  return null;
}
