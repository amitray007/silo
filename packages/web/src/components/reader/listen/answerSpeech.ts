import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { ReadAloudPrefs } from '../../../lib/readerPrefs';
import { useArticleReadAloudPrefs } from '../../../lib/useReaderPrefs';
import { createEngine, type EngineId, type TtsEngine } from './engines';
import { isEnglishText } from './language';
import { Player } from './player';
import { sentenceSpans } from './segments';
import { takeSpeech } from './speechFocus';
import type { Planned } from './speechPlan';
import { useVoiceModel } from './voiceModels';

type Block = { text: string; kind: Planned['kind'] };

const LIST_ITEM = /^([-*+]|\d+[.)])\s+/;
const HEADING = /^#{1,6}\s+/;

function plain(line: string): string {
  return line
    .replace(/^(#{1,6}|>|[-*+]|\d+[.)])\s+/, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/(\*\*|__|\*|`|~~)/g, '');
}

/** Paragraphs, list items and headings of an answer's markdown; code and tables are not read. */
function blocksOf(markdown: string): Block[] {
  const blocks: Block[] = [];
  let open = false;
  for (const raw of markdown.replace(/```[\s\S]*?(```|$)/g, '').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('|')) {
      open = false;
      continue;
    }
    const heading = HEADING.test(line);
    const last = blocks.at(-1);
    if (open && last && !heading && !LIST_ITEM.test(line)) last.text += ` ${plain(line)}`;
    else blocks.push({ text: plain(line), kind: heading ? 'heading' : 'text' });
    open = !heading;
  }
  return blocks;
}

/** The sentences the voice says for an answer, shaped like the article's so the same player reads them. */
export function spokenAnswer(markdown: string): Planned[] {
  return blocksOf(markdown).flatMap((block) => {
    const owner = {} as Element;
    return sentenceSpans(block.text).flatMap((span) => {
      const spoken = block.text.slice(span.start, span.end).replace(/\s+/g, ' ').trim();
      if (!/[\p{L}\p{N}]/u.test(spoken)) return [];
      const text = /[.!?…:;]$/.test(spoken) ? spoken : `${spoken}.`;
      return [{ text, kind: block.kind, block: owner }];
    });
  });
}

/** An idle voice model is released after this long. */
const IDLE_MS = 60_000;

type Phase = 'idle' | 'loading' | 'playing';
type Voice = Pick<ReadAloudPrefs, 'engine' | 'rate' | 'pauses'> & { voice: string };

let now: { key: string | null; phase: Phase } = { key: null, phase: 'idle' };
const listeners = new Set<() => void>();
let run = 0;
let sentences: Planned[] = [];
let voice: Voice = { engine: 'phonon', rate: 1, pauses: 'relaxed', voice: '' };
let loaded: TtsEngine | undefined;
let context: AudioContext | undefined;
let release: () => void = () => {};
let idleTimer: ReturnType<typeof setTimeout> | undefined;

function set(next: typeof now): void {
  now = next;
  for (const listener of listeners) listener();
}

function audioContext(): AudioContext {
  context ??= new AudioContext();
  return context;
}

let player: Player | undefined;
function answerPlayer(): Player {
  player ??= new Player({
    context: audioContext,
    segments: () => sentences,
    settings: () => ({ rate: voice.rate, voice: voice.voice, pauses: voice.pauses }),
    events: {
      sentence: () => {},
      buffering: () => {},
      finished: () => stopAnswerSpeech(now.key),
      failed: () => stopAnswerSpeech(now.key),
      firstAudio: () => {},
    },
  });
  return player;
}

function releaseVoice(): void {
  loaded?.dispose();
  loaded = undefined;
  void context?.close();
  context = undefined;
}

/** One load per engine: answers started while it runs share it instead of creating a second model. */
const loading = new Map<EngineId, Promise<TtsEngine>>();

async function loadEngine(id: EngineId): Promise<TtsEngine> {
  const engine = createEngine(id);
  try {
    await engine.load(() => {});
  } catch (reason) {
    engine.dispose();
    throw reason;
  }
  // Another engine's overlapping load finished first: the newest load replaces it.
  loaded?.dispose();
  loaded = engine;
  return engine;
}

function engineFor(id: EngineId): Promise<TtsEngine> {
  clearTimeout(idleTimer);
  if (loaded?.id === id) return Promise.resolve(loaded);
  const pending = loading.get(id);
  if (pending) return pending;
  releaseVoice();
  const started = loadEngine(id).finally(() => loading.delete(id));
  loading.set(id, started);
  return started;
}

/** Stop the answer with this key if it is the one speaking. */
export function stopAnswerSpeech(key: string | null): void {
  if (key === null || now.key !== key) return;
  run += 1;
  player?.halt();
  release();
  set({ key: null, phase: 'idle' });
  clearTimeout(idleTimer);
  idleTimer = setTimeout(releaseVoice, IDLE_MS);
}

/** Read an answer aloud with the chosen on-device voice, replacing whatever spoke before. */
export async function speakAnswer(key: string, markdown: string, prefs: Voice): Promise<void> {
  if (now.key !== null) stopAnswerSpeech(now.key);
  sentences = spokenAnswer(markdown);
  if (sentences.length === 0) return;
  const token = ++run;
  release = takeSpeech(() => stopAnswerSpeech(key));
  set({ key, phase: 'loading' });
  voice = prefs;
  // Created inside the press, so the browser lets it play.
  void audioContext().resume();
  let engine: TtsEngine;
  try {
    engine = await engineFor(prefs.engine);
  } catch {
    if (token === run) stopAnswerSpeech(key);
    return;
  }
  if (token !== run) return;
  voice = {
    ...prefs,
    voice: engine.voices().some((item) => item.id === prefs.voice) ? prefs.voice : '',
  };
  set({ key, phase: 'playing' });
  answerPlayer().start(engine, 0);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Read aloud for one answer. `available` is false until the owner's chosen voice model is
 * downloaded (Settings → Reader → Voices) or when the answer is not English; it never prompts a download.
 */
export function useAnswerSpeech(key: string, markdown: string) {
  const { prefs } = useArticleReadAloudPrefs();
  const model = useVoiceModel(prefs.engine);
  const phase = useSyncExternalStore(
    subscribe,
    () => (now.key === key ? now.phase : 'idle'),
    () => 'idle' as Phase,
  );
  useEffect(() => () => stopAnswerSpeech(key), [key]);
  const { engine, rate, pauses } = prefs;
  const chosen = prefs.voices[engine];
  const toggle = useCallback(() => {
    if (phase !== 'idle') stopAnswerSpeech(key);
    else void speakAnswer(key, markdown, { engine, rate, pauses, voice: chosen });
  }, [phase, key, markdown, engine, rate, pauses, chosen]);
  return { available: model.phase === 'downloaded' && isEnglishText(markdown), phase, toggle };
}
