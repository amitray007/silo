import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchTtsManifest, ttsFilesBase, ttsFileUrl } from './manifest';

const MANIFEST = {
  engines: {
    phonon: { label: 'P', license: 'Apache-2.0', revision: 'abc123abc123', files: {} },
    kokoro: { label: 'K', license: 'Apache-2.0', revision: 'def456def456', files: {} },
  },
};

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

function stubFetch(handler: () => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(handler));
}

describe('fetchTtsManifest', () => {
  it('returns the server answer and remembers it', async () => {
    stubFetch(async () => Response.json(MANIFEST));
    await expect(fetchTtsManifest()).resolves.toEqual(MANIFEST);
    expect(JSON.parse(localStorage.getItem('silo.ttsManifest') ?? 'null')).toEqual(MANIFEST);
  });

  it('falls back to the remembered answer while silo cannot be reached', async () => {
    stubFetch(async () => Response.json(MANIFEST));
    await fetchTtsManifest();
    stubFetch(async () => Promise.reject(new TypeError('Failed to fetch')));
    await expect(fetchTtsManifest()).resolves.toEqual(MANIFEST);
  });

  it('fails when silo cannot be reached and nothing is remembered', async () => {
    stubFetch(async () => Promise.reject(new TypeError('Failed to fetch')));
    await expect(fetchTtsManifest()).rejects.toThrow();
  });
});

describe('model file addresses', () => {
  it('point at silo, as absolute URLs the workers can use', () => {
    expect(ttsFilesBase(MANIFEST, 'kokoro')).toBe(
      `${location.origin}/api/tts/files/kokoro/def456def456`,
    );
    expect(ttsFileUrl(MANIFEST, 'phonon', 'voices/a b.safetensors')).toBe(
      `${location.origin}/api/tts/files/phonon/abc123abc123/voices/a%20b.safetensors`,
    );
  });
});
