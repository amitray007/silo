import { apiGet, apiUrl } from '../../../../api/client';
import type { EngineId } from './types';

/** What `GET /api/tts/manifest` says about one model file. */
type TtsFileInfo = {
  size: number;
  sha256: string;
  voice?: { name: string; locale: string; gender: string };
};

type TtsEngineInfo = {
  label: string;
  license: string;
  files: Record<string, TtsFileInfo>;
};

export type TtsManifestJson = { engines: Record<EngineId, TtsEngineInfo> };

const CACHE_KEY = 'silo.ttsManifest';

function readCached(): TtsManifestJson | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as TtsManifestJson) : null;
  } catch {
    return null;
  }
}

/**
 * The list of model files silo serves. The last good answer is kept in this browser, so a voice
 * whose files are already cached still loads while silo cannot be reached.
 */
export async function fetchTtsManifest(): Promise<TtsManifestJson> {
  try {
    const manifest = await apiGet<TtsManifestJson>('/api/tts/manifest');
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(manifest));
    } catch {
      // Storage is full or off; the manifest is just not remembered.
    }
    return manifest;
  } catch (error) {
    const cached = readCached();
    if (cached) return cached;
    throw error;
  }
}

/** The absolute URL of silo's route for an engine's files (no trailing slash). */
export function ttsFilesBase(engine: EngineId): string {
  return new URL(apiUrl(`/api/tts/files/${engine}`), location.href).href;
}

export function ttsFileUrl(engine: EngineId, path: string): string {
  return `${ttsFilesBase(engine)}/${path.split('/').map(encodeURIComponent).join('/')}`;
}
