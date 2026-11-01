import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { type ReactNode, useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { makeLink } from '../../../test/fixtures';
import type { LoadProgress, TtsEngine } from '../listen/engines';
import { ReaderContent } from '../ReaderContent';
import { DockHostContext } from './ReaderDock';

const engineState = vi.hoisted(() => ({
  load: undefined as
    | undefined
    | ((onProgress: (...args: [number | null, number, number]) => void) => Promise<void>),
  streamed: [] as string[],
}));

vi.mock('../listen/engines', async (original) => {
  const real = await original<typeof import('../listen/engines')>();
  const make = (id: 'phonon' | 'kokoro'): TtsEngine => ({
    id,
    supportsSpeed: id === 'kokoro',
    sampleRate: 24000,
    device: 'test',
    load: (onProgress: LoadProgress) => engineState.load?.(onProgress) ?? Promise.resolve(),
    voices: () => [
      { id: 'zoe', label: 'Zoey', language: 'en-us', trait: 'female' },
      { id: 'maeve', label: 'Maeve', language: 'en-gb', trait: 'female' },
    ],
    dispose: () => {},
    async *stream(text: string) {
      engineState.streamed.push(text);
      yield new Float32Array(2400);
    },
  });
  return { ...real, createEngine: make };
});

class FakeAudioContext {
  currentTime = 0;
  state = 'running';
  destination = {};
  resume = async () => {};
  close = async () => {};
  createBuffer(_channels: number, length: number, sampleRate: number) {
    const data = new Float32Array(length);
    return { duration: length / sampleRate, getChannelData: () => data };
  }
  createBufferSource() {
    return { buffer: null, onended: null, connect: () => {}, start: () => {}, stop: () => {} };
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function Host({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  return (
    <DockHostContext.Provider
      value={{ element: host, scroll: host, panel: host, report: () => {} }}
    >
      {children}
      <div ref={setHost} data-testid="host" />
    </DockHostContext.Provider>
  );
}

function renderArticle(html: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith('/reader')
        ? json({ capturedAt: null, contentHtml: html, contentImages: [] })
        : json({ error: 'not_found', message: 'none' }, 404),
    ),
  );
  vi.stubGlobal('AudioContext', FakeAudioContext);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Host>
        <ReaderContent link={makeLink({ id: 'listen' })} />
      </Host>
    </QueryClientProvider>,
  );
}

const ENGLISH =
  '<h2>The title</h2><p>The first sentence of the article is here. The second one follows it. ' +
  'And a third closes the paragraph, so there is plenty to read.</p><p>A second paragraph is also here, with enough words in it to count.</p>';
const FRENCH =
  '<p>La ville de Paris est la capitale de la France et elle accueille chaque année des millions de ' +
  'visiteurs venus du monde entier pour admirer ses monuments, ses musées et ses jardins célèbres, ' +
  'et ils reviennent souvent pour la cuisine.</p>';

beforeEach(() => {
  // jsdom has no layout: give ranges and the pane the geometry calls the player makes.
  Range.prototype.getBoundingClientRect = () => new DOMRect(0, 100, 100, 20);
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Element.prototype.scrollTo = () => {};
  localStorage.clear();
  engineState.load = undefined;
  engineState.streamed = [];
});
afterEach(() => vi.unstubAllGlobals());

const toolbar = () => screen.getByRole('toolbar', { name: 'Reader tools' });

/** Press Listen (the player and its sheet open, ready), then Play. Resolves when it is playing. */
async function listen() {
  fireEvent.click(await screen.findByRole('button', { name: 'Listen' }));
  fireEvent.click(await within(toolbar()).findByRole('button', { name: 'Play' }));
  return within(toolbar()).findByRole('button', { name: 'Pause' });
}

it('turns the dock into the player and opens the sheet, ready to play', async () => {
  renderArticle(ENGLISH);
  fireEvent.click(await screen.findByRole('button', { name: 'Listen' }));
  expect(toolbar().getAttribute('data-mode')).toBe('player');
  expect(within(toolbar()).queryByRole('button', { name: 'Type' })).toBeNull();
  expect(within(toolbar()).getByRole('button', { name: 'Play' })).toBeDefined();
  expect(await screen.findByRole('dialog', { name: 'Listen' })).toBeDefined();
  // Opening the sheet warms the voice: the first units are synthesized before Play.
  await waitFor(() => expect(engineState.streamed.length).toBeGreaterThan(0));
  fireEvent.click(within(toolbar()).getByRole('button', { name: 'Play' }));
  expect(await within(toolbar()).findByRole('button', { name: 'Pause' })).toBeDefined();
  // The sentence being read shows beside the controls.
  await waitFor(() => expect(toolbar().textContent).toMatch(/The title|The first sentence/));
});

it('closes the player and brings the tools back', async () => {
  renderArticle(ENGLISH);
  await listen();
  fireEvent.click(screen.getByRole('button', { name: 'Stop reading aloud' }));
  expect(await screen.findByRole('button', { name: 'Type' })).toBeDefined();
  expect(toolbar().getAttribute('data-mode')).toBe('tools');
  expect(screen.queryByRole('dialog', { name: 'Listen' })).toBeNull();
});

it('disables Listen for an article that is not English, with the reason as its title', async () => {
  renderArticle(FRENCH);
  const button = await screen.findByRole('button', { name: 'Listen' });
  expect(button.getAttribute('aria-disabled')).toBe('true');
  expect(button.getAttribute('title')).toBe('Read aloud is English-only for now');
  fireEvent.click(button);
  expect(toolbar().getAttribute('data-mode')).toBe('tools');
  expect(engineState.streamed).toEqual([]);
});

it('plays and pauses on Space, and changes speed on + and -', async () => {
  renderArticle(ENGLISH);
  await listen();
  fireEvent.keyDown(document.body, { key: ' ' });
  expect(await within(toolbar()).findByRole('button', { name: 'Play' })).toBeDefined();
  fireEvent.keyDown(document.body, { key: ' ' });
  expect(await within(toolbar()).findByRole('button', { name: 'Pause' })).toBeDefined();

  fireEvent.keyDown(document.body, { key: '+' });
  await waitFor(() =>
    expect(within(toolbar()).getByRole('button', { name: /^Speed/ }).textContent).toBe('1.25x'),
  );
  fireEvent.keyDown(document.body, { key: '-' });
  fireEvent.keyDown(document.body, { key: '-' });
  await waitFor(() =>
    expect(within(toolbar()).getByRole('button', { name: /^Speed/ }).textContent).toBe('0.75x'),
  );
  expect(JSON.parse(localStorage.getItem('silo.readerReadAloud') ?? '{}').rate).toBe(0.75);
});

it('steps a sentence on the arrow keys', async () => {
  renderArticle(ENGLISH);
  await listen();
  fireEvent.keyDown(document.body, { key: 'ArrowRight' });
  await waitFor(() =>
    expect(toolbar().textContent).toContain('The first sentence of the article is here.'),
  );
  fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
  await waitFor(() => expect(toolbar().textContent).toContain('The title.'));
});

it('leaves Space to a focused button', async () => {
  renderArticle(ENGLISH);
  const pause = await listen();
  const space = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
  act(() => {
    pause.dispatchEvent(space);
  });
  expect(space.defaultPrevented).toBe(false);
});

it('starts at the clicked sentence before anything else sees the click', async () => {
  const { container } = renderArticle(ENGLISH);
  const prose = await waitFor(() => {
    const found = container.querySelector<HTMLElement>('.silo-reader-prose');
    if (!found) throw new Error('prose not rendered yet');
    return found;
  });
  const bubble = vi.fn();
  prose.addEventListener('click', bubble);

  // Listen closed: the click reaches the other handlers (the note popover, the layers list).
  fireEvent.click(prose.querySelectorAll('p')[1] as HTMLElement);
  expect(bubble).toHaveBeenCalledTimes(1);

  await listen();
  bubble.mockClear();
  fireEvent.click(prose.querySelectorAll('p')[1] as HTMLElement);
  expect(bubble).not.toHaveBeenCalled();
  // Reading restarts at the clicked sentence, which the player now shows.
  await waitFor(() => expect(toolbar().textContent).toContain('A second paragraph is also here'));
});

it('leaves links alone while Listen is open', async () => {
  const { container } = renderArticle(
    '<p>Some words before <a href="#x">a link</a> and some words after the link, to be long enough.</p>',
  );
  await listen();
  engineState.streamed = [];
  const anchor = container.querySelector('a') as HTMLElement;
  const clicked = vi.fn();
  anchor.addEventListener('click', clicked);
  fireEvent.click(anchor);
  expect(clicked).toHaveBeenCalledTimes(1);
  expect(engineState.streamed).toEqual([]);
});

it('shows the engine, voice and speed controls, and closes the sheet on Escape', async () => {
  renderArticle(ENGLISH);
  fireEvent.click(await screen.findByRole('button', { name: 'Listen' }));
  const sheet = await screen.findByRole('dialog', { name: 'Listen' });
  expect(within(sheet).getByRole('button', { name: 'Voice engine' }).textContent).toBe('Phonon');
  expect(within(sheet).getByRole('button', { name: 'Voice' }).textContent).toContain('Default');
  expect(within(sheet).getByRole('spinbutton', { name: 'Speed' }).textContent).toBe('1x');
  fireEvent.keyDown(sheet, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Listen' })).toBeNull());
  // The player stays; its list button brings the sheet back.
  expect(toolbar().getAttribute('data-mode')).toBe('player');
  fireEvent.click(within(toolbar()).getByRole('button', { name: 'Read aloud settings' }));
  expect(await screen.findByRole('dialog', { name: 'Listen' })).toBeDefined();
});

it('closes an open voice list on Escape before the sheet', async () => {
  renderArticle(ENGLISH);
  fireEvent.click(await screen.findByRole('button', { name: 'Listen' }));
  const sheet = await screen.findByRole('dialog', { name: 'Listen' });
  await waitFor(() => expect(within(sheet).getByRole('button', { name: 'Voice' })).toBeDefined());
  fireEvent.click(within(sheet).getByRole('button', { name: 'Voice' }));
  const list = await screen.findByRole('listbox', { name: 'Voice' });
  fireEvent.keyDown(list, { key: 'Escape' });
  expect(screen.queryByRole('listbox', { name: 'Voice' })).toBeNull();
  expect(screen.getByRole('dialog', { name: 'Listen' })).toBeDefined();
});

it('groups voices by locale, lets the reader pick one, and remembers it', async () => {
  renderArticle(ENGLISH);
  fireEvent.click(await screen.findByRole('button', { name: 'Listen' }));
  const sheet = await screen.findByRole('dialog', { name: 'Listen' });
  fireEvent.click(within(sheet).getByRole('button', { name: 'Voice' }));
  const list = await screen.findByRole('listbox', { name: 'Voice' });
  await waitFor(() =>
    expect(within(list).getByRole('group', { name: 'English (US)' })).toBeDefined(),
  );
  expect(within(list).getByRole('group', { name: 'English (UK)' })).toBeDefined();
  fireEvent.click(within(list).getByRole('option', { name: /Maeve/ }));
  await waitFor(() =>
    expect(JSON.parse(localStorage.getItem('silo.readerReadAloud') ?? '{}').voices.phonon).toBe(
      'maeve',
    ),
  );
});

it('shows the download state with its percentage and size while the voice loads', async () => {
  let finish: () => void = () => {};
  engineState.load = (onProgress) =>
    new Promise<void>((resolve) => {
      onProgress(42, 4.2 * 1_048_576, 10 * 1_048_576);
      finish = resolve;
    });
  renderArticle(ENGLISH);
  fireEvent.click(await screen.findByRole('button', { name: 'Listen' }));
  const sheet = await screen.findByRole('dialog', { name: 'Listen' });
  const status = await within(sheet).findByRole('status');
  expect(status.textContent).toContain('Downloading voice \u00b7 42%');
  expect(screen.getAllByRole('radiogroup', { name: 'Pauses' })).toHaveLength(1);
  expect(status.textContent).toContain('4.2 / 10.0 MB');
  // Skeleton rows stand in for voices that have not loaded.
  fireEvent.click(within(sheet).getByRole('button', { name: 'Voice' }));
  expect((await screen.findByRole('listbox', { name: 'Voice' })).getAttribute('aria-busy')).toBe(
    'true',
  );
  await act(async () => finish());
});

it('shows a failed load with Retry, and Retry loads again', async () => {
  let attempts = 0;
  engineState.load = () => {
    attempts += 1;
    return attempts === 1
      ? Promise.reject(new Error('the model host answered 502'))
      : Promise.resolve();
  };
  renderArticle(ENGLISH);
  fireEvent.click(await screen.findByRole('button', { name: 'Listen' }));
  const alert = await within(toolbar()).findByRole('alert');
  expect(alert.textContent).toContain('Voice failed: the model host answered 502');
  expect(within(toolbar()).queryByRole('button', { name: 'Pause' })).toBeNull();
  fireEvent.click(within(toolbar()).getByRole('button', { name: 'Retry' }));
  expect(await within(toolbar()).findByRole('button', { name: 'Pause' })).toBeDefined();
  expect(attempts).toBe(2);
});

it('names the engines with a muted trait and no model size', async () => {
  renderArticle(ENGLISH);
  fireEvent.click(await screen.findByRole('button', { name: 'Listen' }));
  const sheet = await screen.findByRole('dialog', { name: 'Listen' });
  fireEvent.click(within(sheet).getByRole('button', { name: 'Voice engine' }));
  const options = await screen.findAllByRole('option');
  expect(options.map((option) => option.textContent)).toEqual([
    'Phonon Fast',
    'Kokoro More voices',
  ]);
  expect(document.body.textContent).not.toMatch(/\d+\s?M\b|MB/);
});

it('switches the engine from the sheet and keeps it for the next play', async () => {
  renderArticle(ENGLISH);
  fireEvent.click(await screen.findByRole('button', { name: 'Listen' }));
  const sheet = await screen.findByRole('dialog', { name: 'Listen' });
  fireEvent.click(within(sheet).getByRole('button', { name: 'Voice engine' }));
  fireEvent.click(await screen.findByRole('option', { name: /^Kokoro/ }));
  await waitFor(() =>
    expect(JSON.parse(localStorage.getItem('silo.readerReadAloud') ?? '{}').engine).toBe('kokoro'),
  );
  fireEvent.click(within(toolbar()).getByRole('button', { name: 'Play' }));
  expect(await within(toolbar()).findByRole('button', { name: 'Pause' })).toBeDefined();
});

it('switches the engine while playing and carries on with the new one', async () => {
  renderArticle(ENGLISH);
  await listen();
  // Pressing Listen opened the sheet, and it is still open.
  fireEvent.click(await screen.findByRole('button', { name: 'Voice engine' }));
  fireEvent.click(await screen.findByRole('option', { name: /^Kokoro/ }));
  expect(await within(toolbar()).findByRole('button', { name: 'Pause' })).toBeDefined();
  expect(JSON.parse(localStorage.getItem('silo.readerReadAloud') ?? '{}').engine).toBe('kokoro');
});

it('names the speed button with its visible value', async () => {
  renderArticle(ENGLISH);
  await listen();
  expect(within(toolbar()).getByRole('button', { name: 'Speed 1x' }).textContent).toBe('1x');
  fireEvent.keyDown(document.body, { key: '+' });
  expect(await within(toolbar()).findByRole('button', { name: 'Speed 1.25x' })).toBeDefined();
});

it('ignores arrows held with Shift, Alt, Meta or Ctrl', async () => {
  renderArticle(ENGLISH);
  await listen();
  const before = toolbar().textContent;
  for (const mod of [{ shiftKey: true }, { altKey: true }, { metaKey: true }, { ctrlKey: true }]) {
    fireEvent.keyDown(document.body, { key: 'ArrowRight', ...mod });
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(toolbar().textContent).toBe(before);
  fireEvent.keyDown(document.body, { key: 'ArrowRight' });
  await waitFor(() => expect(toolbar().textContent).not.toBe(before));
});

it('turns the pencil off when Listen opens, and leaves it off', async () => {
  renderArticle(ENGLISH);
  const pencil = await screen.findByRole('button', { name: 'Pencil' });
  fireEvent.click(pencil);
  expect(pencil.getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(await screen.findByRole('button', { name: 'Listen' }));
  fireEvent.click(await within(toolbar()).findByRole('button', { name: 'Play' }));
  await within(toolbar()).findByRole('button', { name: 'Pause' });
  // The player replaced the tools; closing it shows the pencil off.
  fireEvent.click(screen.getByRole('button', { name: 'Stop reading aloud' }));
  expect((await screen.findByRole('button', { name: 'Pencil' })).getAttribute('aria-pressed')).toBe(
    'false',
  );
});

it('moves focus to Play when the dock becomes the player, and back to Listen when it closes', async () => {
  renderArticle(ENGLISH);
  fireEvent.click(await screen.findByRole('button', { name: 'Listen' }));
  const play = await within(toolbar()).findByRole('button', { name: 'Play' });
  await waitFor(() => expect(document.activeElement).toBe(play));
  fireEvent.click(screen.getByRole('button', { name: 'Stop reading aloud' }));
  const back = await screen.findByRole('button', { name: 'Listen' });
  await waitFor(() => expect(document.activeElement).toBe(back));
});

it('does not take focus on first render', async () => {
  renderArticle(ENGLISH);
  await screen.findByRole('button', { name: 'Listen' });
  expect(document.activeElement).toBe(document.body);
});

it('leaves Escape to the reader once the sheet is closed, and the sheet takes it first', async () => {
  const outer = vi.fn();
  document.addEventListener('keydown', outer);
  renderArticle(ENGLISH);
  fireEvent.click(await screen.findByRole('button', { name: 'Listen' }));
  const sheet = await screen.findByRole('dialog', { name: 'Listen' });
  fireEvent.keyDown(sheet, { key: 'Escape' });
  expect(outer).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Listen' })).toBeNull());
  // Listen itself does not swallow Escape: with nothing else open it reaches the reader.
  fireEvent.keyDown(document.body, { key: 'Escape' });
  expect(outer).toHaveBeenCalledTimes(1);
  document.removeEventListener('keydown', outer);
});

it('keeps Listen keys out of a focused text field', async () => {
  renderArticle(ENGLISH);
  await listen();
  const field = document.createElement('input');
  document.body.append(field);
  field.focus();
  const space = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
  act(() => {
    field.dispatchEvent(space);
  });
  expect(space.defaultPrevented).toBe(false);
  expect(within(toolbar()).getByRole('button', { name: 'Pause' })).toBeDefined();
  field.remove();
});

it('renders the Pauses choices and keeps the selection for the next read', async () => {
  const first = renderArticle(ENGLISH);
  fireEvent.click(await screen.findByRole('button', { name: 'Listen' }));
  const group = screen.getByRole('radiogroup', { name: 'Pauses' });
  expect(
    within(group)
      .getAllByRole('radio')
      .map((option) => option.textContent),
  ).toEqual(['Short', 'Relaxed', 'Natural']);
  expect(within(group).getByRole('radio', { name: 'Relaxed' }).getAttribute('aria-checked')).toBe(
    'true',
  );
  fireEvent.click(within(group).getByRole('radio', { name: 'Natural' }));
  expect(JSON.parse(localStorage.getItem('silo.readerReadAloud') ?? '{}').pauses).toBe('natural');
  first.unmount();
  renderArticle(ENGLISH);
  fireEvent.click(await screen.findByRole('button', { name: 'Listen' }));
  expect(
    within(screen.getByRole('radiogroup', { name: 'Pauses' }))
      .getByRole('radio', { name: 'Natural' })
      .getAttribute('aria-checked'),
  ).toBe('true');
});
