import { apiGet, apiUrl } from '../../../../api/client';
import type { EngineId } from './types';

/** What `GET /api/tts/manifest` says about one model file. */
export type TtsFileInfo = {
  size: number;
  sha256: string;
  voice?: { name: string; locale: string; gender: string };
};

export type TtsEngineInfo = {
  label: string;
  license: string;
  files: Record<string, TtsFileInfo>;
};

export type TtsManifestJson = { engines: Record<EngineId, TtsEngineInfo> };

export function fetchTtsManifest(): Promise<TtsManifestJson> {
  return apiGet<TtsManifestJson>('/api/tts/manifest');
}

/** The absolute URL of silo's route for an engine's files (no trailing slash). */
export function ttsFilesBase(engine: EngineId): string {
  return new URL(apiUrl(`/api/tts/files/${engine}`), location.href).href;
}

export function ttsFileUrl(engine: EngineId, path: string): string {
  return `${ttsFilesBase(engine)}/${path.split('/').map(encodeURIComponent).join('/')}`;
}
