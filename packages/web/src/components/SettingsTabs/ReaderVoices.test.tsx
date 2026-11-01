import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoadProgress } from '../reader/listen/engines';
import { reportReaderLoad, resetVoiceModels } from '../reader/listen/voiceModels';
import { ReaderVoices } from './ReaderVoices';

/** What the fake browser cache holds, per engine. */
const stored = new Set<string>();
const removed: string[] = [];

type Fake = {
  engine: string;
  progress: LoadProgress | null;
  resolve: () => void;
  reject: (error: Error) => void;
  disposed: number;
};
const engines: Fake[] = [];

vi.mock('../reader/listen/engines', async (original) => ({
  ...(await original<typeof import('../reader/listen/engines')>()),
  createEngine: (id: string) => {
    const fake: Fake = {
      engine: id,
      progress: null,
      resolve: () => {},
      reject: () => {},
      disposed: 0,
    };
    engines.push(fake);
    return {
      id,
      load: (onProgress: LoadProgress) =>
        new Promise<void>((resolve, reject) => {
          fake.progress = onProgress;
          fake.resolve = () => {
            stored.add(id);
            resolve();
          };
          fake.reject = reject;
        }),
      dispose: () => {
        fake.disposed += 1;
      },
    };
  },
}));

vi.mock('../reader/listen/engines/files', async (original) => ({
  ...(await original<typeof import('../reader/listen/engines/files')>()),
  isDownloaded: async (id: string) => stored.has(id),
  removeDownload: async (id: string) => {
    removed.push(id);
    stored.delete(id);
  },
  kokoroDtype: async () => 'q8',
}));

vi.mock('../reader/listen/engines/manifest', async (original) => ({
  ...(await original<typeof import('../reader/listen/engines/manifest')>()),
  fetchTtsManifest: async () => ({
    engines: {
      phonon: {
        label: 'Phonon',
        license: 'x',
        revision: 'p',
        files: {
          'model.q8.gguf': { size: 64512352, sha256: 'x' },
          'tokenizer.json': { size: 277967, sha256: 'x' },
          'config.json': { size: 2851, sha256: 'x' },
          'default-voice.safetensors': { size: 256136, sha256: 'x' },
        },
      },
      kokoro: {
        label: 'Kokoro',
        license: 'x',
        revision: 'k',
        files: {
          'config.json': { size: 44, sha256: 'x' },
          'tokenizer.json': { size: 3497, sha256: 'x' },
          'tokenizer_config.json': { size: 113, sha256: 'x' },
          'onnx/model.onnx': { size: 325532232, sha256: 'x' },
          'onnx/model_quantized.onnx': { size: 92361116, sha256: 'x' },
        },
      },
    },
  }),
}));

beforeEach(() => {
  stored.clear();
  removed.length = 0;
  engines.length = 0;
});
afterEach(() => {
  act(() => resetVoiceModels());
});

function row(engine: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-voice-engine="${engine}"]`);
  if (!found) throw new Error(`no row for ${engine}`);
  return found;
}

describe('Voices rows: status', () => {
  it('shows Not downloaded and a Download button when the cache has nothing', async () => {
    render(<ReaderVoices />);
    expect(await within(row('phonon')).findByText('Not downloaded')).toBeDefined();
    expect(within(row('phonon')).getByRole('button', { name: 'Download Phonon' })).toBeDefined();
  });

  it('shows Downloaded and a Remove button when the cache has the files', async () => {
    stored.add('kokoro');
    render(<ReaderVoices />);
    expect(await within(row('kokoro')).findByText('Downloaded')).toBeDefined();
    expect(within(row('kokoro')).getByRole('button', { name: 'Remove Kokoro' })).toBeDefined();
    expect(within(row('phonon')).getByText('Not downloaded')).toBeDefined();
  });
});

describe('Voices rows: download', () => {
  it('reports progress, then Downloaded, and releases the engine', async () => {
    render(<ReaderVoices />);
    fireEvent.click(await screen.findByRole('button', { name: 'Download Phonon' }));
    const phonon = row('phonon');
    expect(within(phonon).getByText('Downloading')).toBeDefined();
    act(() => engines[0]?.progress?.(42, 4200, 10000));
    expect(within(phonon).getByText('Downloading 42%')).toBeDefined();
    expect(phonon.querySelector('.silo-listen-progress > div')?.getAttribute('style')).toContain(
      '42%',
    );
    expect(within(phonon).getByRole('button', { name: 'Cancel Phonon download' })).toBeDefined();
    await act(async () => engines[0]?.resolve());
    await waitFor(() => expect(within(phonon).getByText('Downloaded')).toBeDefined());
    expect(engines[0]?.disposed).toBe(1);
    expect(within(phonon).getByRole('button', { name: 'Remove Phonon' })).toBeDefined();
  });

  it('Cancel releases the engine and goes back to the cache state', async () => {
    render(<ReaderVoices />);
    fireEvent.click(await screen.findByRole('button', { name: 'Download Kokoro' }));
    act(() => engines[0]?.progress?.(10, 1, 10));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel Kokoro download' }));
    expect(engines[0]?.disposed).toBe(1);
    await waitFor(() => expect(within(row('kokoro')).getByText('Not downloaded')).toBeDefined());
    // The load that fails after cancelling does not turn into an error.
    await act(async () => engines[0]?.reject(new Error('Stopped')));
    expect(within(row('kokoro')).queryByText(/failed/)).toBeNull();
  });

  it('shows a failed download with Retry', async () => {
    render(<ReaderVoices />);
    fireEvent.click(await screen.findByRole('button', { name: 'Download Phonon' }));
    await act(async () => engines[0]?.reject(new Error('Network down')));
    const phonon = row('phonon');
    await waitFor(() =>
      expect(within(phonon).getByText('Download failed: Network down')).toBeDefined(),
    );
    fireEvent.click(within(phonon).getByRole('button', { name: 'Retry Phonon' }));
    expect(engines).toHaveLength(2);
  });
});

describe('Voices rows: remove', () => {
  it('Remove deletes the engine files and shows Not downloaded', async () => {
    stored.add('phonon');
    render(<ReaderVoices />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Phonon' }));
    await waitFor(() => expect(within(row('phonon')).getByText('Not downloaded')).toBeDefined());
    expect(removed).toEqual(['phonon']);
  });
});

describe('Voices rows: an open Reader', () => {
  it('shows the Reader download progress without a Cancel button', async () => {
    render(<ReaderVoices />);
    await within(row('kokoro')).findByText('Not downloaded');
    act(() =>
      reportReaderLoad('kokoro', {
        status: 'loading',
        progress: 30,
        bytes: { loaded: 3, total: 10 },
      }),
    );
    const kokoro = row('kokoro');
    expect(within(kokoro).getByText('Downloading 30% for the open article')).toBeDefined();
    expect(within(kokoro).queryByRole('button')).toBeNull();
  });

  it('shows an engine the Reader has loaded as Downloaded, and rechecks when it closes', async () => {
    render(<ReaderVoices />);
    await within(row('phonon')).findByText('Not downloaded');
    stored.add('phonon');
    act(() =>
      reportReaderLoad('phonon', {
        status: 'ready',
        progress: 100,
        bytes: { loaded: 1, total: 1 },
      }),
    );
    expect(within(row('phonon')).getByText('Downloaded, loaded in the open article')).toBeDefined();
    stored.delete('phonon');
    act(() => reportReaderLoad('phonon', null));
    await waitFor(() => expect(within(row('phonon')).getByText('Not downloaded')).toBeDefined());
  });
});
