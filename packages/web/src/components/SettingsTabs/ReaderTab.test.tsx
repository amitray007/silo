import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  highlightPrefsDefaults,
  pencilPrefsDefaults,
  readAloudPrefsDefaults,
  readerTypeDefaults,
  useHighlightPrefs,
  usePencilPrefs,
  useReadAloudPrefs,
  useReaderType,
} from '../../lib/readerPrefs';
import { useReaderWidth } from '../../lib/useReaderWidth';
import { ReaderTab } from './ReaderTab';

const MANIFEST = {
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
        'voices/zoey.safetensors': {
          size: 1,
          sha256: 'x',
          voice: { name: 'Zoey', locale: 'en-us', gender: 'female' },
        },
        'voices/maeve.safetensors': {
          size: 1,
          sha256: 'x',
          voice: { name: 'Maeve', locale: 'en-gb', gender: 'female' },
        },
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
        'voices/af_heart.bin': { size: 1, sha256: 'x' },
      },
    },
  },
};

vi.mock('../reader/listen/engines/manifest', async (original) => ({
  ...(await original<typeof import('../reader/listen/engines/manifest')>()),
  fetchTtsManifest: async () => MANIFEST,
}));

function Providers({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

/** Reads every store the tab edits, so a test can see what the Reader would see. */
function Reader() {
  const { type } = useReaderType();
  const [width] = useReaderWidth();
  const { prefs: pencil } = usePencilPrefs();
  const { color } = useHighlightPrefs();
  const { prefs: aloud } = useReadAloudPrefs();
  return (
    <output data-testid="reader">{JSON.stringify({ type, width, pencil, color, aloud })}</output>
  );
}
function seen() {
  return JSON.parse(screen.getByTestId('reader').textContent ?? '{}');
}

beforeEach(() => {
  vi.stubGlobal('caches', undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of [
    'silo.readerType',
    'silo.readerWidth',
    'silo.readerPencil',
    'silo.readerHighlight',
    'silo.readerReadAloud',
  ])
    localStorage.removeItem(key);
});

function open() {
  return render(
    <>
      <ReaderTab />
      <Reader />
    </>,
    { wrapper: Providers },
  );
}

describe('Reader settings tab', () => {
  it('shows the current values with the default state', () => {
    open();
    expect(seen()).toEqual({
      type: readerTypeDefaults,
      width: 'medium',
      pencil: pencilPrefsDefaults,
      color: highlightPrefsDefaults.color,
      aloud: readAloudPrefsDefaults,
    });
    expect(screen.getByRole('radio', { name: 'Inter' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('spinbutton', { name: 'Size' }).textContent).toBe('16px');
    expect(screen.getByRole('button', { name: 'Voice engine' }).textContent).toContain('Phonon');
  });

  it('writes the type controls to the same store the Reader reads', () => {
    open();
    fireEvent.click(screen.getByRole('radio', { name: 'Mono' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Relaxed' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Wide' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Sepia' }));
    fireEvent.click(screen.getByRole('button', { name: 'Increase size' }));
    expect(seen().type).toEqual({ font: 'mono', size: 17, leading: 'relaxed', theme: 'sepia' });
    expect(seen().width).toBe('wide');
    expect(screen.getByRole('spinbutton', { name: 'Size' }).textContent).toBe('17px');
  });

  it('follows a change made elsewhere (the dock) at once', () => {
    function Dock() {
      const { update } = useReaderType();
      return (
        <button type="button" onClick={() => update({ size: 22 })}>
          dock bigger
        </button>
      );
    }
    render(
      <>
        <ReaderTab />
        <Dock />
      </>,
      { wrapper: Providers },
    );
    fireEvent.click(screen.getByText('dock bigger'));
    expect(screen.getByRole('spinbutton', { name: 'Size' }).textContent).toBe('22px');
  });

  it('edits the pencil and the default highlight colour', () => {
    open();
    fireEvent.click(screen.getByRole('radio', { name: 'Highlighter' }));
    fireEvent.click(screen.getByRole('button', { name: 'Increase pencil speed' }));
    fireEvent.click(screen.getByRole('button', { name: 'pink' }));
    expect(seen().pencil).toEqual({ style: 'highlighter', wpm: 260 });
    expect(seen().color).toBe('pink');
  });

  it('edits read-aloud speed, engine and the voice of that engine, grouped by language', async () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Increase reading speed' }));
    expect(seen().aloud.rate).toBe(1.25);
    fireEvent.click(screen.getByRole('button', { name: 'Voice' }));
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3));
    const list = screen.getAllByRole('option');
    expect(list.map((option) => option.textContent)).toEqual([
      'Default voice✓',
      'Zoey female',
      'Maeve female',
    ]);
    expect(screen.getByText('English (US)')).toBeDefined();
    expect(screen.getByText('English (UK)')).toBeDefined();
    fireEvent.click(screen.getByRole('option', { name: /Maeve/ }));
    expect(seen().aloud.voices).toEqual({ phonon: 'maeve', kokoro: '' });

    fireEvent.click(screen.getByRole('button', { name: 'Voice engine' }));
    fireEvent.click(await screen.findByRole('option', { name: /Kokoro/ }));
    expect(seen().aloud.engine).toBe('kokoro');
    // Kokoro's voices come from the manifest too, and its own choice is kept apart.
    fireEvent.click(screen.getByRole('button', { name: 'Voice' }));
    expect(await screen.findByRole('option', { name: /Heart/ })).toBeDefined();
  });

  it('shows engine names and traits without sizes outside the Voices rows', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Voice engine' }));
    const options = screen.getAllByRole('option').map((option) => option.textContent);
    expect(options).toEqual(['Phonon Fast', 'Kokoro More voices']);
  });
});

describe('Voices rows', () => {
  it('describes each engine with its size, Kokoro for this device', async () => {
    open();
    const phonon = await screen.findByText(/English · 62 MB · Fast, streams as it speaks/);
    expect(phonon).toBeDefined();
    // jsdom has no WebGPU, so Kokoro is the q8 model.
    expect(await screen.findByText(/English · 88 MB on the CPU · More voices/)).toBeDefined();
    expect(within(row('phonon')).getByRole('button', { name: 'Download Phonon' })).toBeDefined();
  });
});

function row(engine: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-voice-engine="${engine}"]`);
  if (!found) throw new Error(`no row for ${engine}`);
  return found;
}
