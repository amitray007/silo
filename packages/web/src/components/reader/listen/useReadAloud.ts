import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  READ_ALOUD_SPEEDS,
  type ReadAloudPauses,
  useReadAloudPrefs,
} from '../../../lib/readerPrefs';
import { paintSpeaking } from '../highlights/paint';
import { proseTextNodes } from '../pencil/lines';
import { articleWords, shareAtPoint, wordAtShare } from '../place/words';
import { createEngine, ENGINES, type EngineId, type TtsEngine, type Voice } from './engines';
import { isEnglishText } from './language';
import { Player } from './player';
import { buildSegments, type Segment, segmentIndexAt } from './segments';
import { reportReaderLoad } from './voiceModels';

type Status = 'idle' | 'loading' | 'ready' | 'error';

/** One engine's load: where it is, how far, what failed, and its voices once it is ready. */
type Load = {
  status: Status;
  progress: number | null;
  bytes: { loaded: number; total: number };
  error: string;
  voices: Voice[];
};
const IDLE: Load = {
  status: 'idle',
  progress: null,
  bytes: { loaded: 0, total: 0 },
  error: '',
  voices: [],
};

/** Playback that stays in a hidden tab this long is paused. */
const HIDDEN_PAUSE_MS = 2 * 60 * 1000;

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
  saved = null,
  canSave = false,
  onSave,
}: {
  prose: HTMLElement | null;
  scroll: HTMLElement | null;
  saved?: number | null;
  canSave?: boolean;
  onSave?: (share: number, options?: { keepalive?: boolean }) => Promise<void>;
}) {
  const { prefs, update } = useReadAloudPrefs();
  const [active, setActive] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [index, setIndex] = useState(0);
  const [segments, setSegments] = useState<Segment[]>([]);
  // Each engine keeps its own download, so switching to one that is still loading shows it.
  const [loads, setLoads] = useState<Record<EngineId, Load>>({ phonon: IDLE, kokoro: IDLE });
  const patch = useCallback(
    (id: EngineId, change: Partial<Load>) =>
      setLoads((previous) => ({ ...previous, [id]: { ...previous[id], ...change } })),
    [],
  );
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

  // Settings → Reader → Voices shows what this Reader has loaded or is downloading.
  useEffect(() => {
    for (const id of ['phonon', 'kokoro'] as const) reportReaderLoad(id, loads[id]);
  }, [loads]);
  useEffect(
    () => () => {
      for (const id of ['phonon', 'kokoro'] as const) reportReaderLoad(id, null);
    },
    [],
  );

  const engineId: EngineId = prefs.engine;
  const { status, progress, bytes, error, voices } = loads[engineId];
  const voiceId = prefs.voices[engineId];
  const rate = prefs.rate;
  const pauses = prefs.pauses;

  // Everything callbacks need to see now, without re-creating them.
  const live = useRef({ index: 0, playing: false, engineId, voiceId, rate, pauses, scroll });
  live.current = { index, playing, engineId, voiceId, rate, pauses, scroll };

  const list = useRef<Segment[]>([]);
  const engines = useRef(new Map<EngineId, TtsEngine>());
  /** Engines whose load has started and not yet finished. */
  const building = useRef(new Map<EngineId, TtsEngine>());
  const disposed = useRef(false);
  const loading = useRef(new Map<EngineId, Promise<TtsEngine>>());
  const context = useRef<AudioContext>(undefined);
  const begun = useRef(false);
  const lastClick = useRef<Node | null>(null);
  // Bumped by every start, stop and engine change; an async start that sees a newer value quits.
  const run = useRef(0);
  const wordList = useRef<Range[]>([]);
  const currentShare = useRef<number | null>(null);
  const position = useRef({ saved, canSave, onSave, prose });
  position.current = { saved, canSave, onSave, prose };
  const flush = useCallback((options?: { keepalive?: boolean }) => {
    const now = position.current;
    const share = currentShare.current;
    if (!begun.current || share === null || !now.canSave || !now.onSave) return;
    void now.onSave(share, options).catch(() => {
      /* The save adapter reports the failure. */
    });
  }, []);

  const forgetPlace = useCallback(() => {
    begun.current = false;
    currentShare.current = null;
  }, []);

  const mark = useCallback((segment: Segment | undefined) => {
    if (segment)
      currentShare.current = shareAtPoint(
        wordList.current,
        segment.range.startContainer,
        segment.range.startOffset,
      );
    paintSpeaking(segment?.range ?? null);
    const pane = live.current.scroll;
    if (segment && pane) scrollToSentence(pane, segment.range);
  }, []);

  const pauseRef = useRef<() => void>(() => {});
  /** The one audio device. If it is suspended or interrupted while playing, playback pauses. */
  const audioContext = useCallback((): AudioContext => {
    if (!context.current) {
      const created = new AudioContext();
      created.onstatechange = () => {
        if (created.state !== 'running' && live.current.playing) pauseRef.current();
      };
      context.current = created;
    }
    return context.current;
  }, []);

  const player = useMemo(
    () =>
      new Player({
        context: () => {
          return audioContext();
        },
        segments: () => list.current,
        settings: () => ({
          rate: live.current.rate,
          voice: live.current.voiceId,
          pauses: live.current.pauses,
        }),
        events: {
          sentence: (at) => {
            live.current.index = at;
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
            patch(live.current.engineId, { status: 'error', error: message });
            setPlaying(false);
          },
          firstAudio: (ms) => setStats((previous) => ({ ...previous, firstAudioMs: ms })),
        },
      }),
    [mark, audioContext, patch],
  );

  const ensure = useCallback((): Segment[] => {
    if (list.current.length === 0 && prose) {
      list.current = buildSegments(prose);
      wordList.current = articleWords(prose);
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
    wordList.current = [];
    currentShare.current = null;
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

  const loadEngine = useCallback(
    (id: EngineId): Promise<TtsEngine> => {
      const ready = engines.current.get(id);
      if (ready) return Promise.resolve(ready);
      const pending = loading.current.get(id);
      if (pending) return pending;
      const engine = createEngine(id);
      building.current.set(id, engine);
      const started = performance.now();
      patch(id, { status: 'loading', progress: null, bytes: { loaded: 0, total: 0 }, error: '' });
      // Ask the browser to keep the cached model.
      void navigator.storage?.persist?.();
      const promise = engine
        .load((percent, loaded, total) => {
          if (!disposed.current) patch(id, { progress: percent, bytes: { loaded, total } });
        })
        .then(() => {
          building.current.delete(id);
          if (disposed.current) {
            // The article closed while the model loaded: free what finished late.
            engine.dispose();
            throw new Error('The voice model was closed while it loaded');
          }
          engines.current.set(id, engine);
          patch(id, { status: 'ready', voices: engine.voices() });
          setStats((previous) => ({
            ...previous,
            loadMs: Math.round(performance.now() - started),
            device: engine.device,
          }));
          return engine;
        })
        .catch((reason: unknown) => {
          building.current.delete(id);
          loading.current.delete(id);
          engine.dispose();
          if (!disposed.current) patch(id, { status: 'error', error: messageOf(reason) });
          throw reason;
        });
      loading.current.set(id, promise);
      return promise;
    },
    [patch],
  );

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
      live.current.index = from;
      setIndex(from);
      mark(sentences[from]);
      // Created inside the press, so the browser lets it play.
      void audioContext().resume();
      let engine: TtsEngine;
      try {
        engine = await loadEngine(live.current.engineId);
      } catch {
        if (token === run.current) setPlaying(false);
        return;
      }
      if (token === run.current) player.start(engine, from);
    },
    [player, ensure, mark, loadEngine, audioContext],
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

  const savedSentence = useCallback(() => {
    const now = position.current;
    const sentences = ensure();
    const word =
      now.prose && now.saved !== null ? wordAtShare(articleWords(now.prose), now.saved) : undefined;
    return word
      ? Math.max(0, segmentIndexAt(sentences, word.startContainer, word.startOffset))
      : firstVisible();
  }, [ensure, firstVisible]);

  // Removal from any source discards Listen's pending position before teardown can flush it.
  const previousSaved = useRef(saved);
  useLayoutEffect(() => {
    const removed = previousSaved.current !== null && saved === null;
    previousSaved.current = saved;
    if (removed) forgetPlace();
    else if (
      !playing &&
      saved !== null &&
      currentShare.current !== null &&
      Math.abs(saved - currentShare.current) > 1e-7
    )
      begun.current = false;
  }, [saved, playing, forgetPlace]);

  const play = useCallback(() => {
    void startAt(begun.current ? live.current.index : savedSentence());
  }, [startAt, savedSentence]);

  const pause = useCallback(() => {
    flush();
    run.current += 1;
    player.halt();
    setPlaying(false);
    setBuffering(false);
  }, [player, flush]);

  pauseRef.current = pause;

  const stop = useCallback(() => {
    flush();
    run.current += 1;
    player.halt();
    setPlaying(false);
    setActive(false);
    setBuffering(false);
    begun.current = false;
    mark(undefined);
  }, [player, mark, flush]);

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
    void startAt(at >= 0 ? at : savedSentence());
  }, [prose, ensure, startAt, savedSentence]);

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

  // Store changes also come from Settings or a server sync, outside this sheet.
  const plannedPauses = useRef(pauses);
  useEffect(() => {
    if (plannedPauses.current === pauses) return;
    plannedPauses.current = pauses;
    restartIfPlaying();
    if (active && !live.current.playing) void warm();
  }, [pauses, active, restartIfPlaying, warm]);

  const setPauses = useCallback((value: ReadAloudPauses) => update({ pauses: value }), [update]);

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
    audioContext();
  }, [ensure, audioContext]);

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
    disposed.current = false;
    const map = engines.current;
    const unfinished = building.current;
    return () => {
      disposed.current = true;
      run.current += 1;
      player.halt();
      void context.current?.close();
      context.current = undefined;
      for (const engine of map.values()) engine.dispose();
      map.clear();
      // A load still running when the article closes is cancelled; if it finishes anyway,
      // `loadEngine` frees it.
      for (const engine of unfinished.values()) engine.dispose();
      unfinished.clear();
      loading.current.clear();
      paintSpeaking(null);
    };
  }, [player]);

  useEffect(() => {
    const hide = () => flush({ keepalive: true });
    const visibility = () => {
      if (document.hidden) hide();
    };
    window.addEventListener('pagehide', hide);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('pagehide', hide);
      document.removeEventListener('visibilitychange', visibility);
      flush();
    };
  }, [flush]);

  // A tab that stays hidden pauses, and so does a suspended or interrupted audio device, so
  // Play resumes cleanly from the same sentence instead of the UI claiming it is playing.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onVisibility = () => {
      clearTimeout(timer);
      if (document.hidden && live.current.playing) timer = setTimeout(pause, HIDDEN_PAUSE_MS);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [pause]);

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
    pauses,
    setPauses,
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
    forgetPlace,
    warm: warmUp,
    retry: () => {
      patch(live.current.engineId, { status: 'idle', error: '' });
      play();
    },
  };
}

export type ReadAloudApi = ReturnType<typeof useReadAloud>;
