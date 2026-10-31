import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { type ReactNode, useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useLink } from '../../../api/hooks';
import type { HighlightJson, LinkJson } from '../../../api/types';
import { makeLink } from '../../../test/fixtures';
import { DockHostContext } from '../dock/ReaderDock';
import { ReaderContent } from '../ReaderContent';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const HTML = '<p>Alpha beta gamma delta.</p><p>The quick brown fox jumps over the lazy dog.</p>';
const prose = { capturedAt: '2026-01-01T00:00:00Z', contentHtml: HTML, contentImages: [] };
const TEXT = 'Alpha beta gamma delta. The quick brown fox jumps over the lazy dog.';

function highlight(overrides: Partial<HighlightJson> = {}): HighlightJson {
  const quote = overrides.quote ?? 'quick brown fox';
  const start = TEXT.indexOf(quote);
  return {
    id: 'h1',
    quote,
    prefix: TEXT.slice(Math.max(0, start - 10), start),
    suffix: TEXT.slice(start + quote.length, start + quote.length + 10),
    startOffset: start,
    endOffset: start + quote.length,
    color: 'yellow',
    note: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

let registry: Map<string, { ranges: Range[]; priority: number }>;
let posts: Array<Record<string, unknown>>;
let serverLink: LinkJson;
let restore: Array<() => void> = [];

function stubGlobal(target: object, key: string, value: unknown) {
  const original = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { configurable: true, writable: true, value });
  restore.push(() => {
    if (original) Object.defineProperty(target, key, original);
    else Reflect.deleteProperty(target, key);
  });
}

beforeEach(() => {
  localStorage.clear();
  registry = new Map();
  posts = [];
  restore = [];
  class FakeHighlight {
    ranges: Range[];
    priority = 0;
    constructor(...ranges: Range[]) {
      this.ranges = ranges;
    }
  }
  stubGlobal(globalThis, 'Highlight', FakeHighlight);
  stubGlobal(globalThis, 'CSS', {
    escape: (value: string) => value,
    highlights: {
      set: (name: string, mark: { ranges: Range[]; priority: number }) => registry.set(name, mark),
      delete: (name: string) => registry.delete(name),
    },
  });
  stubGlobal(HTMLElement.prototype, 'scrollTo', vi.fn());
  stubGlobal(Range.prototype, 'getClientRects', () => [
    { left: 10, top: 10, right: 110, bottom: 30, width: 100, height: 20 },
  ]);
  stubGlobal(Range.prototype, 'getBoundingClientRect', () => ({
    left: 10,
    top: 200,
    right: 110,
    bottom: 220,
    width: 100,
    height: 20,
  }));
  serverLink = makeLink({ id: 'hl', highlights: [] });
});
afterEach(() => {
  for (const undo of restore.reverse()) undo();
  vi.unstubAllGlobals();
});

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

function Reader() {
  const detail = useLink('hl');
  return detail.data ? (
    <article className="silo-reader">
      <ReaderContent link={detail.data.link} />
    </article>
  ) : null;
}

let queryClient: QueryClient;
/** When set, the POST waits for this before answering. */
let holdPost: Promise<void> | null = null;

function mount() {
  holdPost = null;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/reader')) return json(prose);
      if (url.endsWith('/highlights') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        posts.push(body);
        if (holdPost) await holdPost;
        return json({ highlight: { ...highlight(), ...body, id: 'server-1' } }, 201);
      }
      if (url.startsWith('/api/highlights/') && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        posts.push(body);
        return json({ highlight: { ...highlight(), ...body } });
      }
      if (url.startsWith('/api/links/hl')) return json({ link: serverLink });
      return json({ error: 'not_found', message: 'none' }, 404);
    }),
  );
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <Host>
        <Reader />
      </Host>
    </QueryClientProvider>,
  );
}

/** A button in the floating selection toolbar, not the dock's own Highlight and Notes. */
async function toolbarButton(name: RegExp | string) {
  const toolbar = await screen.findByRole('toolbar', { name: 'Selection' });
  return within(toolbar).getByRole('button', { name });
}

/** The lane is an overlay panel in jsdom: no layout, so nothing fits beside the column. */
async function openLane() {
  fireEvent.click(await screen.findByRole('button', { name: /Notes/ }));
  await screen.findByRole('complementary', { name: 'Notes' });
}
const laneEl = () => document.querySelector('[data-notes-lane]') as HTMLElement;

function select(text: string) {
  const prose = document.querySelector('.silo-reader-prose') as HTMLElement;
  const walker = document.createTreeWalker(prose, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const at = (node as Text).data.indexOf(text);
    if (at < 0) continue;
    const range = document.createRange();
    range.setStart(node, at);
    range.setEnd(node, at + text.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    fireEvent.mouseUp(prose);
    return;
  }
  throw new Error(`no text ${text}`);
}

it('paints every stored highlight and leaves an orphan unpainted but listed', async () => {
  serverLink = makeLink({
    id: 'hl',
    highlights: [
      highlight(),
      highlight({
        id: 'h2',
        quote: 'text that is gone now',
        color: 'green',
        startOffset: null,
        endOffset: null,
      }),
    ],
  });
  mount();
  await waitFor(() => expect(registry.get('silo-hl-yellow')).toBeDefined());
  expect(registry.get('silo-hl-yellow')?.ranges[0]?.toString()).toBe('quick brown fox');
  expect(registry.has('silo-hl-green')).toBe(false);
  await openLane();
  expect(await screen.findByText('Passage not found')).toBeDefined();
  expect(within(laneEl()).getByText('quick brown fox')).toBeDefined();
});

it('paints an overlap piece in the innermost colour above the single layers', async () => {
  serverLink = makeLink({
    id: 'hl',
    highlights: [
      highlight({ id: 'a', quote: 'quick brown fox jumps', color: 'yellow' }),
      highlight({ id: 'b', quote: 'brown fox', color: 'blue' }),
    ],
  });
  mount();
  await waitFor(() => expect(registry.get('silo-hl-ov-blue')).toBeDefined());
  expect(registry.get('silo-hl-ov-blue')?.ranges[0]?.toString()).toBe('brown fox');
  expect(registry.get('silo-hl-ov-blue')?.priority).toBeGreaterThan(
    registry.get('silo-hl-blue')?.priority ?? 99,
  );
});

it('disables Notes with a "No highlights yet" title when there are none, and shows a count otherwise', async () => {
  mount();
  const notes = await screen.findByRole('button', { name: /Notes/ });
  expect(notes.getAttribute('aria-disabled')).toBe('true');
  expect(notes.getAttribute('title')).toBe('No highlights yet');
  fireEvent.click(notes);
  expect(notes.getAttribute('aria-pressed')).toBe('false');
  expect(document.querySelector('[data-notes-lane]')).toBeNull();
});

it('lists highlights in the notes lane and counts them', async () => {
  serverLink = makeLink({ id: 'hl', highlights: [highlight({ note: 'my note' })] });
  mount();
  const notes = await screen.findByRole('button', { name: /Notes/ });
  expect(notes.querySelector('.silo-reader-dockbadge')?.textContent).toBe('1');
  fireEvent.click(notes);
  expect(await screen.findByText('my note')).toBeDefined();
  expect(notes.getAttribute('aria-pressed')).toBe('true');
});

it('shows the selection toolbar for a selection and saves a highlight with offsets and context', async () => {
  mount();
  await screen.findByText(/Alpha beta/);
  select('brown fox');
  fireEvent.click(await toolbarButton(/Highlight/));
  await waitFor(() => expect(posts).toHaveLength(1));
  const start = TEXT.indexOf('brown fox');
  expect(posts[0]).toMatchObject({
    quote: 'brown fox',
    prefix: 'Alpha beta gamma delta. The quick ',
    suffix: ' jumps over the lazy dog.',
    startOffset: start,
    endOffset: start + 9,
    color: 'yellow',
  });
  await waitFor(() => expect(registry.get('silo-hl-yellow')).toBeDefined());
  expect(screen.queryByRole('toolbar', { name: 'Selection' })).toBeNull();
});

it('gives an overlapping new highlight the next free colour', async () => {
  serverLink = makeLink({ id: 'hl', highlights: [highlight({ quote: 'quick brown fox' })] });
  mount();
  await waitFor(() => expect(registry.get('silo-hl-yellow')).toBeDefined());
  select('brown fox jumps');
  fireEvent.click(await toolbarButton(/Highlight/));
  await waitFor(() => expect(posts).toHaveLength(1));
  expect(posts[0]?.color).toBe('green');
  expect(JSON.parse(localStorage.getItem('silo.readerHighlight') ?? '{}').color).toBe('green');
});

it('highlights a selection at once while the Highlight sheet is open', async () => {
  mount();
  await screen.findByText(/Alpha beta/);
  const dock = screen.getByRole('toolbar', { name: 'Reader tools' });
  fireEvent.click(dock.querySelector('button[title="Highlight"]') as Element);
  fireEvent.click(screen.getByRole('button', { name: 'pink' }));
  select('lazy dog');
  await waitFor(() => expect(posts).toHaveLength(1));
  expect(posts[0]).toMatchObject({ quote: 'lazy dog', color: 'pink' });
  expect(screen.queryByRole('toolbar', { name: 'Selection' })).toBeNull();
});

it('Note highlights and opens the note popover on the new highlight', async () => {
  mount();
  await screen.findByText(/Alpha beta/);
  select('Alpha beta');
  fireEvent.click(await toolbarButton(/Note/));
  const field = await screen.findByRole('textbox', { name: 'Note' });
  fireEvent.change(field, { target: { value: 'first thoughts' } });
  fireEvent.blur(field);
  await waitFor(() => expect(posts.some((body) => body.note === 'first thoughts')).toBe(true));
});

it('rolls a failed note save back and says so', async () => {
  serverLink = makeLink({ id: 'hl', highlights: [highlight({ note: 'keep me' })] });
  mount();
  await waitFor(() => expect(registry.get('silo-hl-yellow')).toBeDefined());
  fetchFails();
  await openLane();
  fireEvent.click(within(laneEl()).getByRole('button', { name: 'Edit note' }));
  const field = await screen.findByRole('textbox', { name: 'Note' });
  fireEvent.change(field, { target: { value: 'changed' } });
  fireEvent.blur(field);
  expect(await screen.findByRole('alert')).toBeDefined();
  expect(screen.getByRole('alert').textContent).toMatch(/save the note/);
});

function fetchFails() {
  const original = globalThis.fetch;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'PATCH' ? json({ error: 'x', message: 'no' }, 500) : original(input, init),
    ),
  );
}

it('does not offer a toolbar when the link has no highlight data yet (a list row)', async () => {
  const row = makeLink({ id: 'hl' });
  serverLink = row;
  Reflect.deleteProperty(serverLink, 'highlights');
  mount();
  await screen.findByText(/Alpha beta/);
  select('Alpha beta');
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  expect(screen.queryByRole('toolbar', { name: 'Selection' })).toBeNull();
});

it('opens the note popover for the highlight under a click, not for empty space', async () => {
  serverLink = makeLink({ id: 'hl', highlights: [highlight()] });
  mount();
  await waitFor(() => expect(registry.get('silo-hl-yellow')).toBeDefined());
  const proseEl = document.querySelector('.silo-reader-prose') as HTMLElement;
  fireEvent.click(proseEl, { clientX: 500, clientY: 500 });
  expect(screen.queryByRole('dialog', { name: 'Note' })).toBeNull();
  fireEvent.click(proseEl, { clientX: 50, clientY: 20 });
  expect(await screen.findByRole('dialog', { name: 'Note' })).toBeDefined();
});

it('does not highlight a selection that was already there when the Highlight sheet opened', async () => {
  mount();
  await screen.findByText(/Alpha beta/);
  select('brown fox');
  await toolbarButton(/Highlight/);
  const dock = screen.getByRole('toolbar', { name: 'Reader tools' });
  fireEvent.click(dock.querySelector('button[title="Highlight"]') as Element);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
  expect(posts).toHaveLength(0);
  select('lazy dog');
  await waitFor(() => expect(posts).toHaveLength(1));
  expect(posts[0]).toMatchObject({ quote: 'lazy dog' });
});

it('keeps a new highlight on screen when the link refetches before the server answers', async () => {
  mount();
  await screen.findByText(/Alpha beta/);
  let release!: () => void;
  holdPost = new Promise<void>((resolve) => {
    release = resolve;
  });
  select('brown fox');
  fireEvent.click(await toolbarButton(/Highlight/));
  await waitFor(() => expect(registry.get('silo-hl-yellow')).toBeDefined());
  // A refetch lands with a list that does not have the new row yet.
  await act(async () => {
    await queryClient.invalidateQueries({ queryKey: ['link', 'hl'] });
  });
  expect(registry.get('silo-hl-yellow')?.ranges[0]?.toString()).toBe('brown fox');
  await act(async () => {
    release();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(registry.get('silo-hl-yellow')?.ranges).toHaveLength(1);
});

it('closes one layer per Escape: toolbar, then note popover, then the sheet', async () => {
  serverLink = makeLink({ id: 'hl', highlights: [highlight()] });
  mount();
  await waitFor(() => expect(registry.get('silo-hl-yellow')).toBeDefined());
  const dock = screen.getByRole('toolbar', { name: 'Reader tools' });
  fireEvent.click(dock.querySelector('button[title="Type settings"]') as Element);
  await screen.findByRole('dialog', { name: 'Type' });
  fireEvent.click(document.querySelector('.silo-reader-prose') as Element, {
    clientX: 50,
    clientY: 20,
  });
  await screen.findByRole('dialog', { name: 'Note' });
  select('Alpha beta');
  await screen.findByRole('toolbar', { name: 'Selection' });
  fireEvent.keyDown(document.body, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('toolbar', { name: 'Selection' })).toBeNull());
  expect(screen.queryByRole('dialog', { name: 'Note' })).not.toBeNull();
  expect(screen.queryByRole('dialog', { name: 'Type' })).not.toBeNull();
  fireEvent.keyDown(document.body, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Note' })).toBeNull());
  expect(screen.queryByRole('dialog', { name: 'Type' })).not.toBeNull();
  fireEvent.keyDown(document.body, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Type' })).toBeNull());
});

it('moves the toolbar with the selection when the window resizes', async () => {
  mount();
  await screen.findByText(/Alpha beta/);
  select('brown fox');
  const bar = await screen.findByRole('toolbar', { name: 'Selection' });
  const before = bar.style.left;
  stubGlobal(Range.prototype, 'getBoundingClientRect', () => ({
    left: 300,
    top: 400,
    right: 400,
    bottom: 420,
    width: 100,
    height: 20,
  }));
  fireEvent(window, new Event('resize'));
  await waitFor(() => expect(bar.style.left).not.toBe(before));
  expect(bar.style.top).toBe('350px');
});

it('turns off, in the toolbar picker, colours used by highlights the selection overlaps', async () => {
  serverLink = makeLink({
    id: 'hl',
    highlights: [highlight({ quote: 'quick brown fox', color: 'green' })],
  });
  mount();
  await waitFor(() => expect(registry.get('silo-hl-green')).toBeDefined());
  select('brown fox jumps');
  const toolbar = await screen.findByRole('toolbar', { name: 'Selection' });
  fireEvent.keyDown(within(toolbar).getByRole('button', { name: /Highlight/ }), { key: 'ArrowUp' });
  const picker = within(toolbar).getByRole('group', { name: 'Highlight colour' });
  const green = within(picker).getByRole('button', { name: 'green' }) as HTMLButtonElement;
  expect(green.disabled).toBe(true);
  expect(green.title).toBe('Used by an overlapping highlight');
  expect((within(picker).getByRole('button', { name: 'blue' }) as HTMLButtonElement).disabled).toBe(
    false,
  );
  // A colour picked on purpose is applied as is.
  fireEvent.click(within(picker).getByRole('button', { name: 'blue' }));
  await waitFor(() => expect(posts).toHaveLength(1));
  expect(posts[0]?.color).toBe('blue');
});

it('does not report a failed note save when the highlight was deleted right after', async () => {
  serverLink = makeLink({ id: 'hl', highlights: [highlight()] });
  mount();
  await waitFor(() => expect(registry.get('silo-hl-yellow')).toBeDefined());
  const original = globalThis.fetch;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return json({ error: 'not_found', message: 'gone' }, 404);
      }
      if (init?.method === 'DELETE') return new Response(null, { status: 204 });
      return original(input, init);
    }),
  );
  fireEvent.click(document.querySelector('.silo-reader-prose') as Element, {
    clientX: 50,
    clientY: 20,
  });
  const field = await screen.findByRole('textbox', { name: 'Note' });
  fireEvent.change(field, { target: { value: 'typed then deleted' } });
  fireEvent.blur(field);
  fireEvent.click(screen.getByRole('button', { name: 'Delete highlight' }));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 80));
  });
  expect(screen.queryByRole('alert')).toBeNull();
});

const OVERLAPPING = () => [
  highlight({ id: 'outer', quote: 'quick brown fox jumps', color: 'yellow', note: 'outer note' }),
  highlight({ id: 'inner', quote: 'brown fox', color: 'blue' }),
];
/** A real click: press, release, then the click event. */
const clickText = (init: MouseEventInit = {}) => {
  const target = document.querySelector('.silo-reader-prose') as Element;
  const point = { clientX: 50, clientY: 20, ...init };
  fireEvent.mouseDown(target, point);
  fireEvent.mouseUp(target, point);
  fireEvent.click(target, point);
};

it('shows one marker per paragraph with a count when it holds several highlights', async () => {
  serverLink = makeLink({
    id: 'hl',
    highlights: [...OVERLAPPING(), highlight({ id: 'first', quote: 'Alpha beta', color: 'pink' })],
  });
  mount();
  const two = await screen.findByRole('button', { name: '2 highlights on paragraph 2' });
  expect(two.querySelector('small')?.textContent).toBe('2');
  const one = screen.getByRole('button', { name: '1 highlight on paragraph 1' });
  expect(one.querySelector('small')).toBeNull();
});

it('puts a marker and the resume button on different lines when they would share one', async () => {
  serverLink = makeLink({
    id: 'hl',
    highlights: [highlight({ id: 'one', quote: 'Alpha beta', color: 'pink' })],
    readingPosition: { position: 0.4, updatedAt: '2026-01-01T00:00:00Z' },
  });
  mount();
  const marker = await screen.findByRole('button', { name: '1 highlight on paragraph 1' });
  const resume = await screen.findByRole('button', { name: 'Resume reading' });
  expect(marker.style.left).toBe(resume.style.left);
  expect(marker.style.top).not.toBe(resume.style.top);
});

it('opens the lane from a marker, emphasising its note, and closes it from the same marker', async () => {
  serverLink = makeLink({ id: 'hl', highlights: [highlight({ note: 'my note' })] });
  mount();
  const marker = await screen.findByRole('button', { name: '1 highlight on paragraph 2' });
  fireEvent.click(marker);
  await screen.findByRole('complementary', { name: 'Notes' });
  expect(document.querySelector('[data-note="h1"]')?.getAttribute('data-focus')).toBe('true');
  expect(screen.getByRole('button', { name: /Notes/ }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(marker);
  await waitFor(() => expect(document.querySelector('[data-notes-lane]')).toBeNull());
});

it('closes the lane from its close button, from the dock and from Escape', async () => {
  serverLink = makeLink({ id: 'hl', highlights: [highlight({ note: 'my note' })] });
  mount();
  await openLane();
  fireEvent.click(screen.getByRole('button', { name: 'Close notes' }));
  await waitFor(() => expect(document.querySelector('[data-notes-lane]')).toBeNull());
  await openLane();
  fireEvent.click(screen.getByRole('button', { name: /Notes/ }));
  await waitFor(() => expect(document.querySelector('[data-notes-lane]')).toBeNull());
  await openLane();
  fireEvent.keyDown(document.body, { key: 'Escape' });
  await waitFor(() => expect(document.querySelector('[data-notes-lane]')).toBeNull());
});

it('closes the lane when the last highlight is deleted', async () => {
  serverLink = makeLink({ id: 'hl', highlights: [highlight({ note: 'my note' })] });
  mount();
  await openLane();
  const original = globalThis.fetch;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'DELETE' ? new Response(null, { status: 204 }) : original(input, init),
    ),
  );
  fireEvent.click(within(laneEl()).getByRole('button', { name: 'Delete highlight' }));
  await waitFor(() => expect(document.querySelector('[data-notes-lane]')).toBeNull());
});

it('shows a bare highlight as a snippet and turns Add note into an inline field that saves', async () => {
  serverLink = makeLink({ id: 'hl', highlights: [highlight()] });
  mount();
  await openLane();
  fireEvent.click(within(laneEl()).getByRole('button', { name: 'Add note' }));
  const field = within(laneEl()).getByRole('textbox', { name: 'Add a note' });
  fireEvent.change(field, { target: { value: 'from the lane' } });
  fireEvent.blur(field);
  await waitFor(() => expect(posts.some((body) => body.note === 'from the lane')).toBe(true));
});

it('removes the inline field without saving when it is left empty', async () => {
  serverLink = makeLink({ id: 'hl', highlights: [highlight()] });
  mount();
  await openLane();
  fireEvent.click(within(laneEl()).getByRole('button', { name: 'Add note' }));
  fireEvent.blur(within(laneEl()).getByRole('textbox', { name: 'Add a note' }));
  expect(within(laneEl()).queryByRole('textbox')).toBeNull();
  expect(posts).toHaveLength(0);
});

it('opens the layers popover, innermost first, for text covered by two highlights', async () => {
  serverLink = makeLink({ id: 'hl', highlights: OVERLAPPING() });
  mount();
  await waitFor(() => expect(registry.get('silo-hl-blue')).toBeDefined());
  clickText();
  const popover = await screen.findByRole('dialog', { name: 'Layers' });
  const rows = within(popover).getAllByRole('button');
  expect(rows.map((row) => row.textContent)).toEqual([
    'brown fox',
    'quick brown fox jumpsouter note',
  ]);
  expect(within(popover).getByText('2 layers').getAttribute('title')).toBe(
    'Option-click cycles through the layers',
  );
  expect(screen.queryByRole('dialog', { name: 'Note' })).toBeNull();
});

it('moves through the layers with the arrow keys and opens a note with a way back', async () => {
  serverLink = makeLink({ id: 'hl', highlights: OVERLAPPING() });
  mount();
  await waitFor(() => expect(registry.get('silo-hl-blue')).toBeDefined());
  clickText();
  const popover = await screen.findByRole('dialog', { name: 'Layers' });
  const [first, second] = within(popover).getAllByRole('button') as HTMLElement[];
  expect(document.activeElement).toBe(first);
  fireEvent.keyDown(popover, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(second);
  fireEvent.click(second as HTMLElement);
  expect(screen.queryByRole('dialog', { name: 'Layers' })).toBeNull();
  const note = await screen.findByRole('dialog', { name: 'Note' });
  expect((within(note).getByRole('textbox') as HTMLTextAreaElement).value).toBe('outer note');
  fireEvent.click(within(note).getByRole('button', { name: 'Layers' }));
  expect(await screen.findByRole('dialog', { name: 'Layers' })).toBeDefined();
  expect(screen.queryByRole('dialog', { name: 'Note' })).toBeNull();
});

it('cycles the layers on Option-click, wrapping, and starts over after a different spot', async () => {
  serverLink = makeLink({ id: 'hl', highlights: OVERLAPPING() });
  mount();
  await waitFor(() => expect(registry.get('silo-hl-blue')).toBeDefined());
  const noteText = async () =>
    (
      within(await screen.findByRole('dialog', { name: 'Note' })).getByRole(
        'textbox',
      ) as HTMLTextAreaElement
    ).value;
  clickText({ altKey: true });
  expect(await noteText()).toBe('');
  clickText({ altKey: true });
  await waitFor(async () => expect(await noteText()).toBe('outer note'));
  clickText({ altKey: true });
  await waitFor(async () => expect(await noteText()).toBe(''));
  clickText({ altKey: true, clientX: 90 });
  await waitFor(async () => expect(await noteText()).toBe(''));
});

it('emphasises every covering block when the lane is open and overlapping text is clicked', async () => {
  serverLink = makeLink({ id: 'hl', highlights: OVERLAPPING() });
  mount();
  await openLane();
  clickText();
  await waitFor(() =>
    expect(
      Array.from(document.querySelectorAll('[data-note][data-focus="true"]')).map((el) =>
        el.getAttribute('data-note'),
      ),
    ).toEqual(['outer', 'inner']),
  );
  expect(screen.queryByRole('dialog', { name: 'Layers' })).toBeNull();
  expect(screen.queryByRole('dialog', { name: 'Note' })).toBeNull();
});

it('closes the newest layer first: the lane, opened after the layers popover, then the popover', async () => {
  serverLink = makeLink({ id: 'hl', highlights: OVERLAPPING() });
  mount();
  await waitFor(() => expect(registry.get('silo-hl-blue')).toBeDefined());
  clickText();
  await screen.findByRole('dialog', { name: 'Layers' });
  await openLane();
  fireEvent.keyDown(document.body, { key: 'Escape' });
  await waitFor(() => expect(document.querySelector('[data-notes-lane]')).toBeNull());
  expect(screen.queryByRole('dialog', { name: 'Layers' })).not.toBeNull();
  fireEvent.keyDown(document.body, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Layers' })).toBeNull());
});

it('closes the Type sheet before the lane when both are open', async () => {
  serverLink = makeLink({ id: 'hl', highlights: [highlight({ note: 'my note' })] });
  mount();
  await openLane();
  const dock = screen.getByRole('toolbar', { name: 'Reader tools' });
  fireEvent.click(dock.querySelector('button[title="Type settings"]') as Element);
  await screen.findByRole('dialog', { name: 'Type' });
  fireEvent.keyDown(document.body, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Type' })).toBeNull());
  expect(document.querySelector('[data-notes-lane]')).not.toBeNull();
  fireEvent.keyDown(document.body, { key: 'Escape' });
  await waitFor(() => expect(document.querySelector('[data-notes-lane]')).toBeNull());
});

it('closes an open note popover, and forgets its way back, when the layers popover opens', async () => {
  serverLink = makeLink({ id: 'hl', highlights: OVERLAPPING() });
  mount();
  await waitFor(() => expect(registry.get('silo-hl-blue')).toBeDefined());
  clickText();
  const popover = await screen.findByRole('dialog', { name: 'Layers' });
  fireEvent.click(within(popover).getAllByRole('button')[0] as HTMLElement);
  await screen.findByRole('dialog', { name: 'Note' });
  expect(screen.getByRole('button', { name: 'Layers' })).toBeDefined();
  // Clicking the passage again opens the list, not a second popover.
  clickText();
  await screen.findByRole('dialog', { name: 'Layers' });
  expect(screen.queryByRole('dialog', { name: 'Note' })).toBeNull();
  // A plain note opened from there has its own way back, and only one.
  fireEvent.keyDown(document.body, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Layers' })).toBeNull());
  expect(screen.queryByRole('dialog', { name: 'Note' })).toBeNull();
});

it('returns focus to the element that had it when the layers popover closes', async () => {
  serverLink = makeLink({ id: 'hl', highlights: OVERLAPPING() });
  mount();
  await waitFor(() => expect(registry.get('silo-hl-blue')).toBeDefined());
  const marker = await screen.findByRole('button', { name: /highlights on paragraph 2/ });
  marker.focus();
  clickText();
  await screen.findByRole('dialog', { name: 'Layers' });
  expect(document.activeElement).not.toBe(marker);
  fireEvent.keyDown(document.body, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Layers' })).toBeNull());
  expect(document.activeElement).toBe(marker);
});
