import { createKokoroEngine } from './kokoro';
import { createPhononEngine } from './phonon';
import type { EngineId, TtsEngine } from './types';

export type { EngineId, LoadProgress, TtsEngine, Voice } from './types';

export function createEngine(id: EngineId): TtsEngine {
  return id === 'kokoro' ? createKokoroEngine() : createPhononEngine();
}

/**
 * Phonon first: it is the default English voice. The trait is the one muted word the Listen
 * sheet shows beside the name; sizes and details belong to Settings → Reader → Voices.
 */
export const ENGINES: readonly { id: EngineId; label: string; trait: string }[] = [
  { id: 'phonon', label: 'Phonon', trait: 'Fast' },
  { id: 'kokoro', label: 'Kokoro', trait: 'More voices' },
];
