import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { READ_ALOUD_SPEEDS, useReadAloudPrefs } from '../../../lib/readerPrefs';
import { paintSpeaking } from '../highlights/paint';
import { proseTextNodes } from '../pencil/lines';
import { createEngine, ENGINES, type EngineId, type TtsEngine, type Voice } from './engines';
import { isEnglishText } from './language';
import { Player } from './player';
import { buildSegments, type Segment, segmentIndexAt } from './segments';

type Status = 'idle' | 'loading' | 'ready' | 'error';

export type SpeechStats = { loadMs?: number; firstAudioMs?: number; device?: string };

/** The sentence stays this far from the pane's edges while it is read. */
const EDGE_TOP = 70;
const EDGE_BOTTOM = 120;

function scrollToSentence(scroll: HTMLElement, range: Range): void {
  const rect = range.getBoundingClientRect();
  const box = scroll.getBoundingClientRect();
  if (rect.top >= box.top + EDGE_TOP && rect.bottom <= box.bottom - EDGE_BOTTOM) return;
  scroll.scrollTo({
    top: scroll.scrollTop + rect.top - box.top - box.height * 0.3,
    behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
  });
}

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/**
 * Read aloud for the open article: sentences from the prose, an on-device voice model, and the
 * gapless player. The dock and its sheet read this one object.
 */
export function useReadAloud({
  prose,
  scroll,
}: {
  prose: HTMLElement | null;
  scroll: HTMLElement | null;
}) {
  const { prefs, update } = useReadAloudPrefs();
  const [active, setActive] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [index, setIndex] = useState(0);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [progress, setProgress] = useState<number | null>(null);
  const [bytes, setBytes] = useState({ loaded: 0, total: 0 });
  const [error, setError] = useState('');
  const [stats, setStats] = useState<SpeechStats>({});

  const english = useMemo(
    () =>
      prose
        ? isEnglishText(
            proseTextNodes(prose)
              .map((node) => node.data)
              .join(' '),
          )
        : true,
    [prose],
  );

  const engineId: EngineId = prefs.engine;
  const voiceId = prefs.voices[engineId];
  const rate = prefs.rate;

  // Everything callbacks need to see now, without re-creating them.
  const live = useRef({ index: 0, playing: false, engineId, voiceId, rate, scroll });
  live.current = { index, playing, engineId, voiceId, rate, scroll };

  const list = useRef<Segment[]>([]);
  const engines = useRef(new Map<EngineId, TtsEngine>());
  const loading = useRef(new Map<EngineId, Promise<TtsEngine>>());
  const context = useRef<AudioContext>(undefined);
  const begun = useRef(false);
  const lastClick = useRef<Node | null>(null);
  // Bumped by every start, stop and engine change; an async start that sees a newer value quits.
  const run = useRef(0);

  const mark = useCallback((segment: Segment | undefined) => {
    paintSpeaking(segment?.range ?? null);
    const pane = live.current.scroll;
    if (segment && pane) scrollToSentence(pane, segment.range);
  }, []);

  const player = useMemo(
    () =>
      new Player({
        context: () => {
          context.current ??= new AudioContext();
          return context.current;
        },
        segments: () => list.current,
        settings: () => ({ rate: live.current.rate, voice: live.current.voiceId }),
        events: {
          sentence: (at) => {
            setIndex(at);
            mark(list.current[at]);
          },
          buffering: setBuffering,
          finished: () => {
            setPlaying(false);
            begun.current = false;
            mark(undefined);
          },
          failed: (message) => {
            setStatus('error');
            setError(message);
            setPlaying(false);
          },
          firstAudio: (ms) => setStats((previous) => ({ ...previous, firstAudioMs: ms })),
        },
      }),
    [mark],
  );

  const ensure = useCallback((): Segment[] => {
    if (list.current.length === 0 && prose) {
      list.current = buildSegments(prose);
      setSegments(list.current);
    }
    return list.current;
  }, [prose]);

  // New prose means new sentences, and nothing from the old article keeps playing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new article resets this.
  useEffect(() => {
    run.current += 1;
    player.halt();
    list.current = [];
    begun.current = false;
    setSegments([]);
    setIndex(0);
    setActive(false);
    setPlaying(false);
    mark(undefined);
  }, [prose]);

  // The sentence a "Listen from here" without a selection falls back to.
  useEffect(() => {
    if (!prose) return;
    const remember = (event: MouseEvent) => {
      lastClick.current = event.target instanceof Node ? event.target : null;
    };
    prose.addEventListener('mousedown', remember);
    return () => prose.removeEventListener('mousedown', remember);
  }, [prose]);

  const loadEngine = useCallback((id: EngineId): Promise<TtsEngine> => {
    const ready = engines.current.get(id);
    if (ready) return Promise.resolve(ready);
    const pending = loading.current.get(id);
    if (pending) return pending;
    const engine = createEngine(id);
    const started = performance.now();
    setStatus('loading');
    setProgress(null);
    setBytes({ loaded: 0, total: 0 });
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
        setStats((previous) => ({
          ...previous,
          loadMs: Math.round(performance.now() - started),
          device: engine.device,
        }));
        return engine;
      })
      .catch((reason: unknown) => {
        loading.current.delete(id);
        engine.dispose();
        if (live.current.engineId === id) {
          setStatus('error');
          setError(messageOf(reason));
        }
        throw reason;
      });
    loading.current.set(id, promise);
    return promise;
  }, []);

  const firstVisible = useCallback((): number => {
    const pane = live.current.scroll;
    if (!pane) return 0;
    const top = pane.getBoundingClientRect().top + 60;
    const found = ensure().findIndex((segment) => segment.range.getBoundingClientRect().top >= top);
    return Math.max(0, found);
  }, [ensure]);

  const startAt = useCallback(
    async (from: number) => {
      player.press();
      player.halt(true);
      const token = ++run.current;
      const sentences = ensure();
      setActive(true);
      if (!sentences[from]) {
        setPlaying(false);
        return;
      }
      setPlaying(true);
      begun.current = true;
      setIndex(from);
      mark(sentences[from]);
      // Created inside the press, so the browser lets it play.
      context.current ??= new AudioContext();
      void context.current.resume();
      let engine: TtsEngine;
      try {
        engine = await loadEngine(live.current.engineId);
      } catch {
        if (token === run.current) setPlaying(false);
        return;
      }
      if (token === run.current) player.start(engine, from);
    },
    [player, ensure, mark, loadEngine],
  );

  /** Load the model and synthesize the first sentences, so Play is instant. */
  const warm = useCallback(async () => {
    try {
      const engine = await loadEngine(live.current.engineId);
      ensure();
      if (!live.current.playing)
        player.warm(engine, Math.min(list.current.length - 1, firstVisible()));
    } catch {
      // The error state is already set.
    }
  }, [loadEngine, ensure, player, firstVisible]);

  const warmUp = useCallback(() => void warm(), [warm]);

  const restartIfPlaying = useCallback(() => {
    if (live.current.playing) void startAt(live.current.index);
  }, [startAt]);

  const play = useCallback(() => {
    void startAt(begun.current ? live.current.index : firstVisible());
  }, [startAt, firstVisible]);

  const pause = useCallback(() => {
    run.current += 1;
    player.halt();
    setPlaying(false);
    setBuffering(false);
  }, [player]);

  const stop = useCallback(() => {
    run.current += 1;
    player.halt();
    setPlaying(false);
    setActive(false);
    setBuffering(false);
    begun.current = false;
    mark(undefined);
  }, [player, mark]);

  const jump = useCallback(
    (to: number) => {
      const next = Math.min(list.current.length - 1, Math.max(0, to));
      if (live.current.playing) void startAt(next);
      else {
        begun.current = true;
        setIndex(next);
        mark(list.current[next]);
      }
    },
    [startAt, mark],
  );

  /** The sentence a selection starts in, else the last click, else the first one on screen. */
  const startHere = useCallback(() => {
    const sentences = ensure();
    const selection = window.getSelection();
    let at = -1;
    if (selection && !selection.isCollapsed && prose?.contains(selection.anchorNode)) {
      const range = selection.getRangeAt(0);
      at = segmentIndexAt(sentences, range.startContainer, range.startOffset);
    } else if (lastClick.current && prose?.contains(lastClick.current)) {
      const node = lastClick.current;
      at = sentences.findIndex((segment) => segment.block.contains(node));
    }
    void startAt(at >= 0 ? at : firstVisible());
  }, [prose, ensure, startAt, firstVisible]);

  const setRate = useCallback(
    (value: number) => {
      update({ rate: value });
      live.current.rate = value;
      restartIfPlaying();
      // A new speed needs fresh audio on engines with native speed, so warm it before Play.
      if (!live.current.playing) void warm();
    },
    [update, restartIfPlaying, warm],
  );

  const setVoice = useCallback(
    (id: string) => {
      update({ voice: [live.current.engineId, id] });
      live.current.voiceId = id;
      restartIfPlaying();
    },
    [update, restartIfPlaying],
  );

  const setEngine = useCallback(
    (id: EngineId) => {
      const wasPlaying = live.current.playing;
      run.current += 1;
      player.halt();
      update({ engine: id });
      live.current.engineId = id;
      live.current.voiceId = prefs.voices[id];
      const ready = engines.current.get(id);
      setVoices(ready ? ready.voices() : []);
      setStatus(ready ? 'ready' : 'idle');
      setError('');
      if (wasPlaying) void startAt(live.current.index);
      else {
        setPlaying(false);
        void warm();
      }
    },
    [player, update, prefs.voices, startAt, warm],
  );

  const stepRate = useCallback(
    (delta: 1 | -1) => {
      const at = READ_ALOUD_SPEEDS.findIndex((speed) => speed === live.current.rate);
      const next =
        READ_ALOUD_SPEEDS[Math.min(READ_ALOUD_SPEEDS.length - 1, Math.max(0, at + delta))];
      if (next !== undefined) setRate(next);
    },
    [setRate],
  );

  /** The Listen button: open the player, ready to play. The dock opens the sheet, which warms the voice. */
  const begin = useCallback(() => {
    ensure();
    setActive(true);
    // Opening the audio device takes a moment (about 250 ms measured); do it on this press, so
    // Play does not wait for it.
    context.current ??= new AudioContext();
  }, [ensure]);

  // A voice the loaded engine does not have falls back to its default.
  useEffect(() => {
    if (
      status === 'ready' &&
      voiceId &&
      voices.length > 0 &&
      !voices.some((v) => v.id === voiceId)
    ) {
      update({ voice: [engineId, ''] });
    }
  }, [status, voiceId, voices, engineId, update]);

  useEffect(() => {
    const map = engines.current;
    return () => {
      run.current += 1;
      player.halt();
      void context.current?.close();
      for (const engine of map.values()) engine.dispose();
      map.clear();
      paintSpeaking(null);
    };
  }, [player]);

  return {
    english,
    active,
    playing,
    buffering,
    segments,
    index,
    current: segments[index],
    rate,
    setRate,
    stepRate,
    engineId,
    engines: ENGINES,
    setEngine,
    voices,
    voiceId,
    setVoice,
    status,
    progress,
    bytes,
    error,
    stats,
    begin,
    play,
    pause,
    toggle: () => (playing ? pause() : play()),
    stop,
    next: () => jump(index + 1),
    prev: () => jump(index - 1),
    jump,
    startAt: (at: number) => void startAt(at),
    startHere,
    warm: warmUp,
    retry: () => {
      setStatus('idle');
      setError('');
      play();
    },
  };
}

export type ReadAloudApi = ReturnType<typeof useReadAloud>;
