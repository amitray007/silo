import { useEffect, useSyncExternalStore } from 'react';
import { createEngine, type EngineId, type TtsEngine } from './engines';
import { isDownloaded, removeDownload } from './engines/files';

/**
 * What this browser holds for each voice engine, shared by Settings → Reader → Voices and the
 * open Reader. "Downloaded" means the engine's required files are in the browser's cache; a
 * download from Settings goes through the same `engine.load` as Listen, then releases the engine.
 */
export type VoiceModelState = {
  phase: 'checking' | 'absent' | 'downloading' | 'downloaded' | 'error';
  /** Percent when the total is known. */
  progress: number | null;
  bytes: { loaded: number; total: number };
  error: string;
  /** Who is downloading: Settings can cancel its own; a Reader's belongs to the Reader. */
  by: 'settings' | 'reader' | null;
  /** A Reader holds the engine in memory right now. */
  loaded: boolean;
};

const START: VoiceModelState = {
  phase: 'checking',
  progress: null,
  bytes: { loaded: 0, total: 0 },
  error: '',
  by: null,
  loaded: false,
};

/** What a Reader reports about its engine, matching `useReadAloud`'s per-engine load. */
export type ReaderLoad = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  progress: number | null;
  bytes: { loaded: number; total: number };
};

type Run = { engine: TtsEngine; cancelled: boolean };

const states = new Map<EngineId, VoiceModelState>();
const runs = new Map<EngineId, Run>();
const listeners = new Set<() => void>();

function read(id: EngineId): VoiceModelState {
  return states.get(id) ?? START;
}

function write(id: EngineId, change: Partial<VoiceModelState>): void {
  states.set(id, { ...read(id), ...change });
  for (const listener of listeners) listener();
}

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/** Re-reads the cache, unless a download is running or a Reader holds the engine. */
async function refreshVoiceModel(id: EngineId): Promise<void> {
  const present = await isDownloaded(id);
  const now = read(id);
  if (now.phase === 'downloading') return;
  write(id, { phase: present ? 'downloaded' : 'absent', error: '' });
}

/** Downloads the engine's files into the cache, then releases the engine. */
export async function downloadVoiceModel(id: EngineId): Promise<void> {
  if (read(id).phase === 'downloading') return;
  const run: Run = { engine: createEngine(id), cancelled: false };
  runs.set(id, run);
  write(id, {
    phase: 'downloading',
    progress: null,
    bytes: { loaded: 0, total: 0 },
    error: '',
    by: 'settings',
  });
  // Ask the browser to keep the cached model.
  void navigator.storage?.persist?.();
  try {
    await run.engine.load((progress, loaded, total) => {
      if (!run.cancelled) write(id, { progress, bytes: { loaded, total } });
    });
    run.engine.dispose();
    if (!run.cancelled) write(id, { phase: 'downloaded', progress: 100, by: null });
  } catch (reason) {
    run.engine.dispose();
    if (!run.cancelled) write(id, { phase: 'error', error: messageOf(reason), by: null });
  } finally {
    if (runs.get(id) === run) {
      runs.delete(id);
      // A cancelled download may still have finished filling the cache.
      if (run.cancelled) void refreshVoiceModel(id);
    }
  }
}

/** Stops waiting for a download Settings started. Phonon cannot abort its transfer. */
export function cancelVoiceModel(id: EngineId): void {
  const run = runs.get(id);
  if (!run || read(id).by !== 'settings') return;
  run.cancelled = true;
  run.engine.dispose();
  runs.delete(id);
  write(id, { phase: 'checking', progress: null, by: null });
  void refreshVoiceModel(id);
}

/** Deletes the engine's files from the browser's cache. */
export async function removeVoiceModel(id: EngineId): Promise<void> {
  if (read(id).phase === 'downloading') return;
  try {
    await removeDownload(id);
  } catch (reason) {
    write(id, { phase: 'error', error: messageOf(reason) });
    return;
  }
  await refreshVoiceModel(id);
}

/** An open Reader reports its engine's load, or null when it closes. */
export function reportReaderLoad(id: EngineId, load: ReaderLoad | null): void {
  if (read(id).by === 'settings') return;
  if (load?.status === 'loading') {
    write(id, {
      phase: 'downloading',
      progress: load.progress,
      bytes: load.bytes,
      by: 'reader',
      loaded: false,
      error: '',
    });
  } else if (load?.status === 'ready') {
    write(id, { phase: 'downloaded', by: null, loaded: true, error: '' });
  } else {
    // Idle, failed, or closed: only a state this Reader set needs undoing.
    const now = read(id);
    if (now.by !== 'reader' && !now.loaded) return;
    write(id, { by: null, loaded: false, ...(now.by === 'reader' ? { phase: 'checking' } : {}) });
    void refreshVoiceModel(id);
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The state of one engine's files, checked against the cache when first used. */
export function useVoiceModel(id: EngineId): VoiceModelState {
  const state = useSyncExternalStore(
    subscribe,
    () => read(id),
    () => START,
  );
  useEffect(() => {
    if (read(id).phase === 'checking') void refreshVoiceModel(id);
  }, [id]);
  return state;
}

/** Test hook: forget everything. */
export function resetVoiceModels(): void {
  for (const run of runs.values()) {
    run.cancelled = true;
    run.engine.dispose();
  }
  runs.clear();
  states.clear();
  for (const listener of listeners) listener();
}
