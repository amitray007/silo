import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import type {
  FrameHint,
  LinkJson,
  LiveReaderJson,
  SettingsMap,
  TrashLinkJson,
} from '../../api/types';
import { layoutMedia } from '../../lib/breakpoints';
import {
  githubSourceData,
  hackerNewsSourceData,
  makeLink,
  makeTrashLink,
  twitterSourceData,
  youtubeSourceData,
} from '../../test/fixtures';
import { ThemeProvider } from '../../theme/ThemeProvider';

const settings: SettingsMap = {
  theme: 'light',
  trashPurgeDays: 30,
  mcpAccess: true,
  linkPreviewImages: true,
  hoverPreview: true,
  ai: { enabled: false, features: {} },
  plugins: {
    hacker_news: { enabled: true, inline: true, hover: true, palette: true },
    twitter: { enabled: true, inline: true, hover: true, palette: true },
    github: { enabled: true, hover: true, palette: true },
    youtube: { enabled: true, hover: true, palette: true },
  },
};
const a = makeLink({
  id: 'a',
  title: 'First link',
  url: 'https://example.com/first',
  extractedText: 'First paragraph.\n\nSecond paragraph.',
});
const b = makeLink({
  id: 'b',
  title: 'Second link',
  url: 'https://example.com/second',
  description: 'Description fallback.',
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function detailResponse(path: string, links: LinkJson[]) {
  const link = links.find((link) => path === `/api/links/${link.id}`);
  return link ? json({ link }) : json({ error: 'not_found', message: 'Unknown link' }, 404);
}

/** The live Reader route: a configured Reader, or 404 for a page with none. */
function readerResponse(path: string, readers: Record<string, LiveReaderJson>) {
  const reader = readers[path.split('/')[3] ?? ''];
  return reader ? json(reader) : json({ error: 'not_found', message: 'No Reader content' }, 404);
}

function frameResponse(link: LinkJson, hint: FrameHint | undefined) {
  return json(hint ?? { mode: link.url.endsWith('.zip') ? 'none' : 'direct' });
}

function HistoryProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="url">
        {location.pathname}
        {location.search}
      </output>
      <button type="button" onClick={() => navigate(-1)}>
        Browser back
      </button>
    </>
  );
}

function renderReader({
  live = [a, b],
  trash = [],
  extra = [],
  readers = {},
  route = '/',
  liveCount,
  trashCount,
  tagCount,
  pageSize = Infinity,
  frameHint,
}: {
  live?: LinkJson[];
  trash?: TrashLinkJson[];
  extra?: LinkJson[];
  readers?: Record<string, LiveReaderJson>;
  route?: string;
  liveCount?: number;
  trashCount?: number;
  tagCount?: number;
  pageSize?: number;
  frameHint?: FrameHint;
} = {}) {
  const state = { live: [...live], trash: [...trash], settings: { ...settings } };
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    const method = init?.method ?? 'GET';
    const url = new URL(path, 'https://silo.test');
    const reads: Record<string, () => Response> = {
      '/api/auth/check': () => json({ authRequired: false }),
      '/api/settings': () => json(state.settings),
      '/api/tags': () => json({ tags: [{ name: 'mcp', count: tagCount ?? state.live.length }] }),
      '/api/counts': () =>
        json({
          live: liveCount ?? state.live.length,
          trash: trashCount ?? state.trash.length,
          purgeWindowDays: 30,
        }),
      ...Object.fromEntries(
        [...state.live, ...extra].flatMap((link) => [
          [`/api/links/${link.id}/frame`, () => frameResponse(link, frameHint)],
          [
            `/api/links/${link.id}/reader`,
            () => readerResponse(`/api/links/${link.id}/reader`, readers),
          ],
        ]),
      ),
      '/api/trash': () => json({ links: state.trash }),
      '/api/links': () => {
        const offset = Number(url.searchParams.get('cursor') ?? 0);
        const end = offset + pageSize;
        return json({
          links: state.live.slice(offset, end),
          nextCursor: end < state.live.length ? String(end) : undefined,
        });
      },
    };
    const read = reads[url.pathname];
    if (method === 'HEAD') return new Response(null);
    if (method === 'GET' && read) return read();
    if (path === '/api/settings' && method === 'PATCH') {
      state.settings = { ...state.settings, ...JSON.parse(String(init?.body)) };
      return json(state.settings);
    }
    if (method === 'POST') return mutate(path, state);
    if (method === 'DELETE' && path.startsWith('/api/trash/')) {
      state.trash = state.trash.filter((link) => link.id !== path.split('/').at(-1));
      return new Response(null, { status: 204 });
    }
    return detailResponse(path, [...state.live, ...extra]);
  });
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rendered = render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <MemoryRouter initialEntries={[route]}>
          <App />
          <HistoryProbe />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { ...rendered, fetchMock };
}

function mutate(path: string, state: { live: LinkJson[]; trash: TrashLinkJson[] }) {
  const id = path.split('/')[3];
  if (path.endsWith('/restore')) {
    const link = state.trash.find((link) => link.id === id);
    state.trash = state.trash.filter((link) => link.id !== id);
    if (link) state.live.push(link);
    return json({ outcome: 'restored', link });
  }
  const link = state.live.find((link) => link.id === id);
  if (!link) return json({ error: 'not_found', message: 'Unknown link' }, 404);
  if (path.endsWith('/trash')) {
    state.trash.push(makeTrashLink({ ...link, deletedAt: new Date().toISOString() }));
    state.live = state.live.filter((link) => link.id !== id);
  }
  if (path.endsWith('/retry')) link.captureStatus = 'enriching';
  return json({ link });
}

const reader = () => within(screen.getByRole('region', { name: 'Link reader' }));
/** Content assertions run on Reader, the default tab; switch back if a test left Live open. */
const selected = async (title = 'First link') =>
  waitFor(() => {
    const tab = reader().getByRole<HTMLButtonElement>('tab', { name: 'Reader' });
    if (!tab.disabled && tab.getAttribute('aria-selected') !== 'true') fireEvent.click(tab);
    expect(reader().getByRole('heading', { level: 2, name: title })).toBeDefined();
    expect(reader().queryByLabelText('Loading article')).toBeNull();
  });
async function selectFirst() {
  await waitFor(() => expect(screen.getByText('First link')).toBeDefined());
  fireEvent.click(screen.getByText('First link'));
  await selected();
}

beforeEach(() => {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('list pane resizing', () => {
  const divider = () => screen.getByRole('separator', { name: 'Resize link list' });
  let paneWidth = 1200;
  beforeEach(() => {
    paneWidth = 1200;
    // jsdom has no layout; give the three-pane row a desktop width so 720px fits beside the reader.
    const measure = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.classList.contains('silo-three-pane')) return new DOMRect(240, 0, paneWidth, 900);
      if (this.classList.contains('silo-listpane')) return new DOMRect(240, 0, 360, 900);
      return measure.call(this);
    });
  });

  it('caps the list so the reader keeps 420px in a narrow window', async () => {
    paneWidth = 784;
    localStorage.setItem('silo.listWidth', '700');
    renderReader();
    await waitFor(() => expect(screen.getByText('First link')).toBeDefined());
    expect(divider().getAttribute('aria-valuenow')).toBe('364');
    expect(divider().getAttribute('aria-valuemax')).toBe('364');
    fireEvent.keyDown(divider(), { key: 'ArrowLeft' });
    expect(divider().getAttribute('aria-valuenow')).toBe('348');
    fireEvent.keyDown(divider(), { key: 'End' });
    expect(divider().getAttribute('aria-valuenow')).toBe('364');
  });

  it('shows a keyboard accessible separator on desktop with the stored width', async () => {
    localStorage.setItem('silo.listWidth', '500');
    const { container } = renderReader();
    await waitFor(() => expect(screen.getByText('First link')).toBeDefined());
    expect(divider().getAttribute('aria-orientation')).toBe('vertical');
    expect(divider().getAttribute('aria-valuemin')).toBe('280');
    expect(divider().getAttribute('aria-valuemax')).toBe('720');
    expect(divider().getAttribute('aria-valuenow')).toBe('500');
    expect(divider().tabIndex).toBe(0);
    expect(
      container.querySelector<HTMLElement>('.silo-three-pane')?.style.getPropertyValue('--list-w'),
    ).toBe('500px');
  });

  it('hides the separator in full-window reader mode without discarding the preference', async () => {
    const media = window.matchMedia;
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      ...media(query),
      matches: query === layoutMedia.fullWindowReader,
    }));
    localStorage.setItem('silo.listWidth', '600');
    renderReader({ route: '/?link=a' });
    await selected();
    expect(screen.queryByRole('separator', { name: 'Resize link list' })).toBeNull();
    expect(localStorage.getItem('silo.listWidth')).toBe('600');
  });

  it('changes the width by 16px and persists it with ArrowRight', async () => {
    renderReader();
    await waitFor(() => expect(screen.getByText('First link')).toBeDefined());
    divider().focus();
    fireEvent.keyDown(divider(), { key: 'ArrowRight' });
    expect(divider().getAttribute('aria-valuenow')).toBe('376');
    expect(localStorage.getItem('silo.listWidth')).toBe('376');
    fireEvent.keyDown(divider(), { key: 'ArrowLeft' });
    expect(divider().getAttribute('aria-valuenow')).toBe('360');
  });

  it('supports 64px shift steps and the Home and End bounds', async () => {
    renderReader();
    await waitFor(() => expect(screen.getByText('First link')).toBeDefined());
    fireEvent.keyDown(divider(), { key: 'ArrowRight', shiftKey: true });
    expect(divider().getAttribute('aria-valuenow')).toBe('424');
    fireEvent.keyDown(divider(), { key: 'ArrowLeft', shiftKey: true });
    expect(divider().getAttribute('aria-valuenow')).toBe('360');
    fireEvent.keyDown(divider(), { key: 'Home' });
    expect(divider().getAttribute('aria-valuenow')).toBe('280');
    fireEvent.keyDown(divider(), { key: 'ArrowLeft' });
    expect(divider().getAttribute('aria-valuenow')).toBe('280');
    fireEvent.keyDown(divider(), { key: 'End' });
    expect(divider().getAttribute('aria-valuenow')).toBe('720');
    fireEvent.keyDown(divider(), { key: 'ArrowRight' });
    expect(divider().getAttribute('aria-valuenow')).toBe('720');
  });

  it.each(['Enter', 'double-click'])('resets to the default with %s', async (action) => {
    localStorage.setItem('silo.listWidth', '500');
    renderReader();
    await waitFor(() => expect(screen.getByText('First link')).toBeDefined());
    if (action === 'Enter') fireEvent.keyDown(divider(), { key: 'Enter' });
    else fireEvent.doubleClick(divider());
    expect(divider().getAttribute('aria-valuenow')).toBe('360');
    expect(localStorage.getItem('silo.listWidth')).toBeNull();
  });

  it('keeps r/j/k shortcuts idle while focused and restores them outside the divider', async () => {
    renderReader({ route: '/?link=a' });
    await selected();
    divider().focus();
    for (const key of ['r', 'j', 'k']) {
      fireEvent.keyDown(divider(), { key });
      expect(screen.getByTestId('url').textContent).toBe('/?link=a');
      expect(reader().getByRole('tab', { name: 'Reader' }).getAttribute('aria-selected')).toBe(
        'true',
      );
    }
    divider().blur();
    fireEvent.keyDown(document, { key: 'j' });
    await selected('Second link');
    fireEvent.keyDown(document, { key: 'k' });
    await selected();
    fireEvent.keyDown(document, { key: 'r' });
    expect(reader().getByRole('tab', { name: 'Live' }).getAttribute('aria-selected')).toBe('true');
  });

  function preparePointerDrag() {
    // jsdom has no PointerEvent or pointer capture; preserve pointer coordinates and IDs.
    vi.stubGlobal(
      'PointerEvent',
      class extends MouseEvent {
        readonly pointerId: number;
        constructor(type: string, init: PointerEventInit = {}) {
          super(type, init);
          this.pointerId = init.pointerId ?? 1;
        }
      },
    );
    const handle = divider();
    const capture = vi.fn();
    const release = vi.fn();
    Object.assign(handle, {
      setPointerCapture: capture,
      hasPointerCapture: () => true,
      releasePointerCapture: release,
    });
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 600 });
    return { handle, capture, release };
  }

  it.each(['pointerUp', 'pointerCancel', 'lostPointerCapture'] as const)(
    'drags relative to the list edge and clears drag state on %s',
    async (finish) => {
      renderReader();
      await waitFor(() => expect(screen.getByText('First link')).toBeDefined());
      const { handle, capture, release } = preparePointerDrag();
      expect(capture).toHaveBeenCalledWith(1);
      // A mouse drag must not focus the handle, or the global focus outline boxes it.
      expect(document.activeElement).not.toBe(handle);
      expect(document.documentElement.classList.contains('silo-list-resizing')).toBe(true);
      fireEvent.pointerMove(handle, { pointerId: 2, clientX: 900 });
      expect(handle.getAttribute('aria-valuenow')).toBe('360');
      fireEvent.pointerMove(handle, { pointerId: 1, clientX: 740.4 });
      expect(handle.getAttribute('aria-valuenow')).toBe('500');
      expect(localStorage.getItem('silo.listWidth')).toBe('500');
      fireEvent[finish](handle, { pointerId: 1 });
      expect(release).toHaveBeenCalledWith(1);
      expect(document.documentElement.classList.contains('silo-list-resizing')).toBe(false);
      fireEvent.pointerMove(handle, { pointerId: 1, clientX: 800 });
      expect(handle.getAttribute('aria-valuenow')).toBe('500');
    },
  );

  it('cleans up the drag and pointer capture when unmounted', async () => {
    const { unmount } = renderReader();
    await waitFor(() => expect(screen.getByText('First link')).toBeDefined());
    const { release } = preparePointerDrag();
    unmount();
    expect(release).toHaveBeenCalledWith(1);
    expect(document.documentElement.classList.contains('silo-list-resizing')).toBe(false);
  });
});

describe('reader selection and history', () => {
  it.each(['/?link=a', '/tags/mcp?link=a', '/trash?link=a'])(
    'returns to the same reader URL after visiting Settings from %s',
    async (route) => {
      renderReader({ route, trash: [makeTrashLink(a)] });
      await selected();
      fireEvent.click(screen.getByRole('link', { name: /settings/i }));
      expect(screen.getByRole('dialog', { name: 'Settings' })).toBeDefined();
      expect(screen.getByTestId('url').textContent).toBe(route);
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull();
      expect(screen.getByTestId('url').textContent).toBe(route);
      await selected();
    },
  );

  it('keeps favicons on hover and focus, with no multi-select controls', async () => {
    const { container } = renderReader({ route: '/?link=a' });
    await selected();
    const row = container.querySelector<HTMLElement>('[data-link-id="a"]') as HTMLElement;
    const favicon = row.querySelector('.silo-letter-chip');
    expect(favicon).not.toBeNull();
    fireEvent.mouseEnter(row);
    fireEvent.focus(row);
    expect(row.querySelector('.silo-letter-chip')).toBe(favicon);
    expect(within(row).queryByRole('button', { name: /Select/ })).toBeNull();
    fireEvent.click(
      within(row.parentElement as HTMLElement).getByRole('button', { name: 'More actions' }),
    );
    expect(screen.queryByRole('menuitem', { name: /Select/ })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Move to trash' })).toBeDefined();
  });

  it.each(['metaKey', 'ctrlKey', 'shiftKey'])(
    'preserves native %s clicks without changing reader selection',
    async (modifier) => {
      const { container } = renderReader({ route: '/?link=a' });
      await selected();
      const row = container.querySelector<HTMLElement>('[data-link-id="b"]') as HTMLElement;
      expect(fireEvent.click(row, { [modifier]: true })).toBe(true);
      expect(screen.getByTestId('url').textContent).toBe('/?link=a');
      expect(row.getAttribute('data-active')).toBe('false');
      expect(screen.queryByRole('button', { name: /Select/ })).toBeNull();
      fireEvent.click(row);
      await selected('Second link');
      expect(screen.getByTestId('url').textContent).toBe('/?link=b');
    },
  );

  it('pushes URL selection, fetches row detail, and browser Back returns to the list', async () => {
    const { fetchMock, container } = renderReader();
    await selectFirst();
    expect(screen.getByTestId('url').textContent).toBe('/?link=a');
    expect(fetchMock.mock.calls.some(([path]) => String(path) === '/api/links/a')).toBe(true);
    expect(container.querySelector('.silo-three-pane')?.getAttribute('data-reader')).toBe('true');
    fireEvent.click(screen.getByText('Browser back'));
    await waitFor(() => expect(screen.getByTestId('url').textContent).toBe('/'));
    expect(container.querySelector('.silo-three-pane')?.getAttribute('data-reader')).toBe('false');
  });
  it('fetches an unloaded deep link by id', async () => {
    const hidden = makeLink({ id: 'deep', title: 'Deep link' });
    const { fetchMock } = renderReader({ extra: [hidden], route: '/?link=deep' });
    await selected('Deep link');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/links/deep',
      expect.objectContaining({ credentials: 'include' }),
    );
  });
  it('shows an empty reader for an unknown id', async () => {
    const { fetchMock } = renderReader({ route: '/?link=missing' });
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/links/missing', expect.any(Object)),
    );
    await waitFor(() => expect(reader().getByText('Select a link to read')).toBeDefined());
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('preserves the tag route when selecting and closing', async () => {
    renderReader({ route: '/tags/mcp' });
    await selectFirst();
    expect(screen.getByTestId('url').textContent).toBe('/tags/mcp?link=a');
    fireEvent.click(reader().getByRole('button', { name: 'Close reader' }));
    await waitFor(() => expect(screen.getByTestId('url').textContent).toBe('/tags/mcp'));
  });
  it('resolves trash from its query without requesting the live-link endpoint', async () => {
    const { fetchMock } = renderReader({ trash: [makeTrashLink(a)], route: '/trash?link=a' });
    await selected();
    expect(reader().getByText(/In trash · Purges in/)).toBeDefined();
    expect(fetchMock.mock.calls.some(([path]) => String(path) === '/api/links/a')).toBe(false);
  });
});

describe('reader content', () => {
  it('renders blank-line paragraphs as text, including HTML-shaped text', async () => {
    const text = '<img src=x onerror=alert(1)>\n\n<script>alert(1)</script>';
    renderReader({ live: [makeLink({ ...a, extractedText: text })], route: '/?link=a' });
    await selected();
    const paragraph = reader().getByText('<img src=x onerror=alert(1)>');
    expect(paragraph.tagName).toBe('P');
    expect(reader().getByText('<script>alert(1)</script>').tagName).toBe('P');
    expect(reader().queryByRole('img')).toBeNull();
  });
  it.each([
    [hackerNewsSourceData, '342'],
    [githubSourceData, '58100'],
    [twitterSourceData, 'Amit Ray'],
    [youtubeSourceData, 'Fireship'],
  ] as const)('renders captured %s data', async (sourceData, text) => {
    renderReader({ live: [makeLink({ ...a, sourceData })], route: '/?link=a' });
    await selected();
    expect(reader().getByText(text)).toBeDefined();
    if (sourceData.kind === 'youtube')
      expect(reader().getByRole('img').getAttribute('src')).toBe('/api/preview-image?linkId=a');
  });
  it('falls back to the description', async () => {
    renderReader({ route: '/?link=b' });
    await selected('Second link');
    expect(reader().getByText('Description fallback.')).toBeDefined();
  });
  it('shows the capturing skeleton and agent attribution', async () => {
    renderReader({
      live: [makeLink({ ...a, captureStatus: 'enriching', addedBy: 'agent' })],
      route: '/?link=a',
    });
    await selected();
    const capturing = reader().getByRole('status', { name: 'Capturing page' });
    expect(capturing.textContent).toBe('');
    expect(capturing.querySelectorAll('.silo-reader-skeleton').length).toBeGreaterThan(4);
    expect(reader().getByText('◆ Added by Claude')).toBeDefined();
    expect(reader().getByText('Capturing').className).toBe('silo-sr-only');
    expect(document.querySelector('.silo-reader-source[data-capturing]')).not.toBeNull();
  });
  it.each(['partial', 'bare'] as const)(
    'retries a %s capture with no text',
    async (captureStatus) => {
      const { fetchMock } = renderReader({
        live: [makeLink({ ...a, captureStatus, extractedText: null })],
        route: '/?link=a',
      });
      await selected();
      fireEvent.click(reader().getByRole('button', { name: 'Retry capture' }));
      await waitFor(() =>
        expect(fetchMock).toHaveBeenCalledWith(
          '/api/links/a/retry',
          expect.objectContaining({ method: 'POST' }),
        ),
      );
    },
  );
  it('offers the live page when a PDF has no Reader text', async () => {
    renderReader({
      live: [
        makeLink({
          ...a,
          url: 'https://arxiv.org/pdf/1706.03762',
          captureStatus: 'partial',
          extractedText: null,
          description: null,
        }),
      ],
      route: '/?link=a',
    });
    await selected();
    expect(reader().getByRole('heading', { name: 'No text to read' })).toBeDefined();
    expect(reader().getByText(/This link is a PDF/)).toBeDefined();
    fireEvent.click(reader().getByRole('button', { name: 'Show live page' }));
    await waitFor(() =>
      expect(reader().getByRole('tab', { name: 'Live' }).getAttribute('aria-selected')).toBe(
        'true',
      ),
    );
  });
  it('does not offer the live page for a trashed link with no text', async () => {
    renderReader({
      trash: [makeTrashLink({ ...a, extractedText: null, description: null })],
      route: '/trash?link=a',
    });
    await selected();
    expect(reader().getByRole('heading', { name: 'No text to read' })).toBeDefined();
    expect(reader().queryByRole('button', { name: 'Show live page' })).toBeNull();
  });
  it('renders the Original iframe with the required sandbox and an escape link', async () => {
    const { container } = renderReader({ route: '/?link=a' });
    await selected();
    fireEvent.click(reader().getByRole('tab', { name: 'Live' }));
    await waitFor(() => expect(container.querySelector('iframe')?.getAttribute('src')).toBe(a.url));
    const frame = container.querySelector('iframe');
    expect(frame?.getAttribute('sandbox')).toBe(
      'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation',
    );
    expect(frame?.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(frame?.getAttribute('loading')).toBeNull();
    expect(reader().getByRole('button', { name: 'Open original' })).toBeDefined();
    expect(reader().queryByRole('button', { name: 'Show silo view' })).toBeNull();
  });
  it('does not mount an unrequested Original iframe when selecting another link', async () => {
    const attributes = vi.spyOn(HTMLIFrameElement.prototype, 'setAttribute');
    const { container } = renderReader({ route: '/?link=a' });
    await selected();
    fireEvent.click(reader().getByRole('tab', { name: 'Live' }));
    fireEvent.click(within(reader().getByRole('toolbar')).getByRole('button', { name: 'Next' }));
    await selected('Second link');
    expect(container.querySelector('iframe')).toBeNull();
    expect(attributes).not.toHaveBeenCalledWith('src', b.url);
  });
  it('opens note and tag editing at the requested field', async () => {
    renderReader({ route: '/?link=a' });
    await selected();
    fireEvent.click(reader().getByRole('button', { name: 'Add a note' }));
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Note' }));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });
    fireEvent.click(reader().getByRole('button', { name: 'Tag' }));
    expect(screen.getByPlaceholderText('Find or create tag')).toBeDefined();
  });
});

describe('reader keyboard and phone toolbar', () => {
  it('moves with j/k/arrows, toggles Original with r, copies with c, opens with o, and closes with Escape', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    renderReader();
    await waitFor(() => expect(screen.getByText('First link')).toBeDefined());
    fireEvent.keyDown(document, { key: 'j' });
    await selected();
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    await selected('Second link');
    fireEvent.keyDown(document, { key: 'ArrowUp' });
    await selected();
    fireEvent.keyDown(document, { key: 'j' });
    await selected('Second link');
    fireEvent.keyDown(document, { key: 'k' });
    await selected();
    fireEvent.keyDown(document, { key: 'r' });
    expect(reader().getByRole('tab', { name: 'Live' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(document, { key: 'c' });
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(a.url));
    fireEvent.keyDown(document, { key: 'o' });
    expect(open).toHaveBeenCalledWith(a.url, '_blank', 'noopener,noreferrer');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.getByTestId('url').textContent).toBe('/'));
  });
  it.each(['Delete', 'Backspace'])('edits with e and trashes with %s', async (key) => {
    const { fetchMock } = renderReader({ route: '/?link=a' });
    await selected();
    fireEvent.keyDown(document, { key: 'e' });
    expect(screen.getByRole('dialog', { name: 'Edit link' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.keyDown(document, { key });
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/links/a/trash',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    await selected('Second link');
    expect(screen.getByTestId('url').textContent).toBe('/?link=b');
  });
  it.each(['input', 'textarea', 'contenteditable'])(
    'ignores reader and palette shortcuts while typing in %s',
    async (kind) => {
      const { fetchMock } = renderReader({ route: '/?link=a' });
      await selected();
      const entry = document.createElement(kind === 'contenteditable' ? 'div' : kind);
      if (kind === 'contenteditable') entry.setAttribute('contenteditable', 'true');
      document.body.append(entry);
      entry.focus();
      for (const key of [
        'j',
        'k',
        'ArrowDown',
        'ArrowUp',
        'e',
        'o',
        'c',
        'r',
        'Delete',
        'Backspace',
        '[',
        'n',
        '/',
      ])
        fireEvent.keyDown(entry, { key });
      fireEvent.keyDown(entry, { key: 'k', metaKey: true });
      expect(screen.getByTestId('url').textContent).toBe('/?link=a');
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
      entry.remove();
    },
  );
  it('never binds Delete or Backspace to restoring or purging trash', async () => {
    const { fetchMock } = renderReader({ trash: [makeTrashLink(a)], route: '/trash?link=a' });
    await selected();
    fireEvent.keyDown(document, { key: 'Delete' });
    fireEvent.keyDown(document, { key: 'Backspace' });
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === 'POST' || init?.method === 'DELETE'),
    ).toBe(false);
  });
  it('does not close a newer selection when an older trash request finishes', async () => {
    const { fetchMock } = renderReader({ route: '/?link=a' });
    await selected();
    const original = fetchMock.getMockImplementation();
    if (!original) throw new Error('Missing fixture fetch');
    let finish: (response: Response) => void = () => {};
    const pending = new Promise<Response>((resolve) => {
      finish = resolve;
    });
    fetchMock.mockImplementation((input, init) =>
      init?.method === 'POST' && String(input) === '/api/links/a/trash'
        ? pending
        : original(input, init),
    );
    fireEvent.click(reader().getByRole('button', { name: 'Move to trash' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/links/a/trash',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    fireEvent.click(screen.getByText('Second link'));
    await selected('Second link');
    await act(async () => {
      finish(json({ link: a }));
    });
    expect(screen.getByTestId('url').textContent).toBe('/?link=b');
    expect(reader().getByRole('heading', { level: 2, name: 'Second link' })).toBeDefined();
  });
  it('keeps a failed trash action selected and reports the error', async () => {
    const { fetchMock } = renderReader({ route: '/?link=a' });
    await selected();
    const original = fetchMock.getMockImplementation();
    if (!original) throw new Error('Missing fixture fetch');
    fetchMock.mockImplementation((input, init) =>
      init?.method === 'POST'
        ? Promise.resolve(json({ error: 'unavailable', message: 'Try again later' }, 503))
        : original(input, init),
    );
    fireEvent.click(reader().getByRole('button', { name: 'Move to trash' }));
    await waitFor(() => expect(reader().getByRole('status').textContent).toBe('Try again later'));
    expect(screen.getByTestId('url').textContent).toBe('/?link=a');
    await selected();
  });
  it('keeps header actions wired, with bounded previous/next', async () => {
    const { fetchMock } = renderReader({ route: '/?link=a' });
    await selected();
    const toolbar = reader();
    expect((toolbar.getByRole('button', { name: 'Previous' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(toolbar.getByRole('button', { name: 'Next' }));
    await selected('Second link');
    fireEvent.click(toolbar.getByRole('button', { name: 'Previous' }));
    await selected();
    fireEvent.click(toolbar.getByRole('button', { name: 'Copy link' }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(a.url));
    fireEvent.click(toolbar.getByRole('button', { name: 'More actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    expect(screen.getByRole('dialog', { name: 'Edit link' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(toolbar.getByRole('button', { name: 'Move to trash' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/links/a/trash',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });
  it('restores trash from the header', async () => {
    const { fetchMock } = renderReader({ trash: [makeTrashLink(a)], route: '/trash?link=a' });
    await selected();
    const toolbar = within(document.querySelector('.silo-reader-inline-actions') as HTMLElement);
    fireEvent.click(toolbar.getByRole('button', { name: 'Restore' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/links/a/restore',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    await waitFor(() => expect(screen.getByTestId('url').textContent).toBe('/trash'));
  });
  it('deletes a selected trashed link from its trash strip', async () => {
    const { fetchMock } = renderReader({ trash: [makeTrashLink(a)], route: '/trash?link=a' });
    await selected();
    fireEvent.click(reader().getByRole('button', { name: 'Delete forever' }));
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/trash/a',
      expect.objectContaining({ method: 'DELETE' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByTestId('url').textContent).toBe('/trash?link=a');
    fireEvent.click(reader().getByRole('button', { name: 'Delete forever' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm permanent deletion' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/trash/a',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );
    await waitFor(() => expect(screen.getByTestId('url').textContent).toBe('/trash'));
  });
  it('closes the phone More actions layer before closing the reader', async () => {
    renderReader({ route: '/?link=a' });
    await selected();
    const more = reader().getByRole('button', { name: 'More actions' });
    fireEvent.click(more);
    expect(more.getAttribute('aria-expanded')).toBe('true');
    const items = screen.getAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'Edite',
      'Open originalo',
      'Copy linkc',
      'Refresh readerr',
      'Tags',
      'Enrich',
      'Move to trash⌫',
    ]);
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByTestId('url').textContent).toBe('/?link=a');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.getByTestId('url').textContent).toBe('/'));
  });
  it('opens capture with n and the palette with slash or command-K', async () => {
    renderReader();
    await waitFor(() => expect(screen.getByText('First link')).toBeDefined());
    for (const key of ['n', '/', 'k']) {
      fireEvent.keyDown(document, { key, metaKey: key === 'k' });
      expect(screen.getByRole('dialog')).toBeDefined();
      expect(document.activeElement?.tagName).toBe('INPUT');
      fireEvent.keyDown(document, { key: 'Escape' });
    }
  });
  it('syncs the sidebar theme toggle through settings', async () => {
    const { fetchMock } = renderReader();
    await waitFor(() => expect(screen.getByText('First link')).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: 'Dark mode' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/settings',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ theme: 'dark' }) }),
      ),
    );
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
    expect(screen.getByRole('button', { name: 'Light mode' })).toBeDefined();
  });
  it('persists the wide sidebar collapse choice without changing URL selection', async () => {
    const media = window.matchMedia;
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      ...media(query),
      matches: query === layoutMedia.sidebar,
    }));
    renderReader({ route: '/?link=a' });
    await selected();
    fireEvent.keyDown(document, { key: '[' });
    expect(localStorage.getItem('silo.sidebarCollapsed')).toBe('true');
    fireEvent.keyDown(document, { key: '[' });
    expect(localStorage.getItem('silo.sidebarCollapsed')).toBe('false');
    expect(screen.getByTestId('url').textContent).toBe('/?link=a');
  });
});

describe('review regressions', () => {
  it('dismisses previews on navigation and never previews the active row', async () => {
    const media = window.matchMedia;
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      ...media(query),
      matches: query === '(hover: hover)',
    }));
    const { container } = renderReader({ route: '/?link=a' });
    await selected();
    const first = container.querySelector<HTMLElement>('[data-link-id="a"]');
    const second = container.querySelector<HTMLElement>('[data-link-id="b"]');
    fireEvent.mouseEnter(second as HTMLElement);
    await waitFor(() => expect(document.querySelector('.silo-popover')).not.toBeNull());
    // Even navigation against the first-row boundary closes the preview.
    fireEvent.keyDown(document, { key: 'k' });
    expect(document.querySelector('.silo-popover')).toBeNull();
    fireEvent.mouseEnter(first as HTMLElement);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    expect(document.querySelector('.silo-popover')).toBeNull();
    fireEvent.mouseEnter(second as HTMLElement);
    await waitFor(() => expect(document.querySelector('.silo-popover')).not.toBeNull());
    fireEvent.click(second as HTMLElement);
    await selected('Second link');
    expect(document.querySelector('.silo-popover')).toBeNull();
  });

  it('shows an empty capture hint and the original link for a full capture without text', async () => {
    renderReader({ live: [makeLink({ ...a, extractedText: null })], route: '/?link=a' });
    await selected();
    expect(reader().getByRole('heading', { name: 'No text to read' })).toBeDefined();
    expect(reader().getByRole('link', { name: 'Open original' }).getAttribute('href')).toBe(a.url);
    expect(reader().queryByRole('button', { name: 'Retry capture' })).toBeNull();
  });

  it('moves focus from the selected row action to the next selected link', async () => {
    const { container } = renderReader({ route: '/?link=a' });
    await selected();
    const first = container.querySelector('[data-link-id="a"]');
    const second = container.querySelector('[data-link-id="b"]');
    const wrap = first?.closest('.silo-row-wrap') as HTMLElement;
    const action = within(wrap).getByRole('button', { name: 'More actions' });
    act(() => action.focus());
    expect(document.activeElement).toBe(action);
    fireEvent.keyDown(action, { key: 'j' });
    await selected('Second link');
    expect(document.activeElement).toBe(second);
    expect(action.tabIndex).toBe(-1);
  });

  it('moves row focus with keyboard selection and keeps one row in the tab order', async () => {
    const { container } = renderReader();
    await waitFor(() => expect(screen.getByText('First link')).toBeDefined());
    const first = container.querySelector<HTMLElement>('[data-link-id="a"]');
    const second = container.querySelector<HTMLElement>('[data-link-id="b"]');
    first?.focus();
    fireEvent.click(first as HTMLElement);
    await selected();
    fireEvent.keyDown(first as HTMLElement, { key: 'j' });
    await selected('Second link');
    expect(document.activeElement).toBe(second);
    expect(first?.tabIndex).toBe(-1);
    expect(second?.tabIndex).toBe(0);
    expect(first?.getAttribute('aria-current')).toBeNull();
    expect(second?.getAttribute('aria-current')).toBe('true');
  });

  it.each([
    ['/', 'Library', { liveCount: 60000 }, '60k'],
    ['/tags/mcp', '# mcp', { tagCount: 1234 }, '1234'],
    ['/trash', 'Trash', { trashCount: 3456 }, '3.5k'],
  ] as const)(
    'shows the server total in the %s list header',
    async (route, title, counts, total) => {
      // The switcher only shows while the sidebar is out of view.
      localStorage.setItem('silo.sidebarCollapsed', 'true');
      renderReader({ route, ...counts, trash: [makeTrashLink(a)] });
      const heading = await screen.findByRole('heading', { level: 1, name: title });
      if (title === 'Library' || title === 'Trash') {
        fireEvent.click(within(heading).getByRole('button'));
        await waitFor(() =>
          expect(screen.getByRole('menuitem', { name: new RegExp(title) }).textContent).toContain(
            total,
          ),
        );
      } else {
        await waitFor(() =>
          expect(heading.parentElement?.querySelector('.silo-pane-count')?.textContent).toBe(total),
        );
      }
    },
  );

  it.each([
    ['a', [a, b], 'Second link', '/?link=b'],
    ['b', [a, b], 'First link', '/?link=a'],
    ['a', [a], null, '/'],
  ] as const)(
    'replaces the selected URL after removing row %s',
    async (id, links, nextTitle, url) => {
      const { container } = renderReader({ live: [...links] });
      await waitFor(() => expect(screen.getByText('First link')).toBeDefined());
      const row = container.querySelector<HTMLElement>(`[data-link-id="${id}"]`);
      fireEvent.click(row as HTMLElement);
      await selected(id === 'a' ? 'First link' : 'Second link');
      fireEvent.click(
        within((row as HTMLElement).parentElement as HTMLElement).getByRole('button', {
          name: 'More actions',
        }),
      );
      fireEvent.click(screen.getByText('Move to trash'));
      await waitFor(() => expect(screen.getByTestId('url').textContent).toBe(url));
      if (nextTitle) await selected(nextTitle);
      fireEvent.click(screen.getByText('Browser back'));
      await waitFor(() => expect(screen.getByTestId('url').textContent).toBe('/'));
    },
  );

  it('keeps the row deletion confirmation trapped while the optimistic removal is pending', async () => {
    const { container, fetchMock } = renderReader({
      trash: [makeTrashLink(a), makeTrashLink(b)],
      route: '/trash?link=a',
    });
    await selected();
    const original = fetchMock.getMockImplementation();
    let finish: (() => void) | undefined;
    fetchMock.mockImplementation(async (input, init) => {
      if (String(input) === '/api/trash/a' && init?.method === 'DELETE') {
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
      }
      return original?.(input, init) as Promise<Response>;
    });
    const row = container.querySelector<HTMLElement>('[data-link-id="a"]');
    fireEvent.click(
      within((row as HTMLElement).parentElement as HTMLElement).getByRole('button', {
        name: 'More actions',
      }),
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete now' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm permanent deletion' }));
    await waitFor(() => expect(container.querySelector('[data-link-id="a"]')).toBeNull());
    const panel = screen.getByRole('alertdialog');
    expect(document.activeElement).toBe(panel);
    expect(screen.getByRole('button', { name: 'Confirm permanent deletion' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(fireEvent.keyDown(panel, { key: 'Tab' })).toBe(false);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('alertdialog')).toBe(panel);
    await act(async () => {
      finish?.();
    });
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    await selected('Second link');
  });

  it('advances the trash reader after a row menu deletion', async () => {
    const { container } = renderReader({
      trash: [makeTrashLink(a), makeTrashLink(b)],
      route: '/trash?link=a',
    });
    await selected();
    const row = container.querySelector<HTMLElement>('[data-link-id="a"]');
    fireEvent.click(
      within((row as HTMLElement).parentElement as HTMLElement).getByRole('button', {
        name: 'More actions',
      }),
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete now' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm permanent deletion' }));
    await selected('Second link');
    expect(screen.getByTestId('url').textContent).toBe('/trash?link=b');
  });

  it('fetches the next page from the phone toolbar and advances past the loaded boundary', async () => {
    const media = window.matchMedia;
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      ...media(query),
      matches: query === layoutMedia.phone || query === layoutMedia.fullWindowReader,
    }));
    const { fetchMock } = renderReader({ pageSize: 1, route: '/?link=a' });
    await selected();
    const next = within(reader().getByRole('toolbar')).getByRole('button', { name: 'Next' });
    expect((next as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(next);
    await selected('Second link');
    expect(fetchMock).toHaveBeenCalledWith('/api/links?cursor=1', expect.any(Object));
    expect((next as HTMLButtonElement).disabled).toBe(true);
  });

  it('closes one layer per Escape: row menu, reader', async () => {
    const { container } = renderReader({ route: '/?link=a' });
    await selected();
    const row = container.querySelector<HTMLElement>('[data-link-id="a"]');
    const options = within((row as HTMLElement).parentElement as HTMLElement).getByRole('button', {
      name: 'More actions',
    });
    fireEvent.click(options);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(options.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByTestId('url').textContent).toBe('/?link=a');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.getByTestId('url').textContent).toBe('/'));
  });

  it('keeps trash content readable without edit controls or the edit shortcut', async () => {
    renderReader({
      trash: [makeTrashLink({ ...a, notes: 'Saved note', tags: ['mcp'] })],
      route: '/trash?link=a',
    });
    await selected();
    expect(reader().getByText('Saved note')).toBeDefined();
    expect(reader().getByRole('link', { name: /#\s*mcp/ })).toBeDefined();
    fireEvent.click(reader().getByRole('button', { name: 'More actions' }));
    expect(screen.queryByRole('menuitem', { name: 'Edit' })).toBeNull();
    expect(reader().queryByRole('button', { name: 'Edit tags' })).toBeNull();
    expect(reader().getByText('Saved note').closest('button')).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.keyDown(document, { key: 'e' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps focus on the phone view tabs while switching with arrows', async () => {
    const media = window.matchMedia;
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      ...media(query),
      matches: query === layoutMedia.phone || query === layoutMedia.fullWindowReader,
    }));
    renderReader({ route: '/?link=a' });
    await selected();
    const tab = reader().getByRole('tab', { name: 'Reader' });
    tab.focus();
    fireEvent.keyDown(tab, { key: 'ArrowRight' });
    const original = reader().getByRole('tab', { name: 'Live' });
    expect(document.activeElement).toBe(original);
    fireEvent.keyDown(original, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(tab);
  });
  it('loads live Reader prose for a listed row, sanitizes it, and preserves API image indices', async () => {
    const { container, fetchMock } = renderReader({
      route: '/?link=a',
      readers: {
        a: {
          capturedAt: null,
          contentHtml:
            '<h1>Article heading</h1><p style="color:red" onclick="bad()">Safe prose <a href="javascript:alert(1)">bad link</a><a href="https://react.dev">React docs</a></p><script>alert(1)</script><img src="https://cdn.test/a.png" onerror="bad()"><img src="https://cdn.test/a.png"><img src="https://cdn.test/extra.png"><pre><code>const a = 1;</code></pre><table><caption>Values</caption><tbody><tr><td>A</td></tr></tbody></table>',
          contentImages: ['https://cdn.test/a.png', 'https://cdn.test/a.png'],
        },
      },
    });
    await selected();
    await waitFor(() => expect(screen.getByText('Article heading')).toBeDefined());
    expect(fetchMock).toHaveBeenCalledWith('/api/links/a', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/links/a/reader', expect.any(Object));
    const prose = container.querySelector('.silo-reader-prose');
    expect(prose?.querySelector('script, [style], [onclick], [onerror]')).toBeNull();
    expect(prose?.querySelector('a')?.getAttribute('href')).toBeNull();
    const anchor = within(prose as HTMLElement).getByRole('link', { name: 'React docs' });
    expect(anchor.getAttribute('target')).toBe('_blank');
    expect(anchor.getAttribute('rel')).toBe('noopener noreferrer');
    expect(
      Array.from(prose?.querySelectorAll('img') ?? [], (img) => img.getAttribute('src')),
    ).toEqual(['/api/links/a/content-image/0', '/api/links/a/content-image/1']);
    expect(prose?.querySelector('img')?.getAttribute('loading')).toBe('lazy');
    expect(within(prose as HTMLElement).getByRole('region', { name: 'Values' })).toBeDefined();
    expect(reader().queryByText('First paragraph.')).toBeNull();
  });

  it.each([
    ['https://youtube.com/watch?v=jNQXAC9IVRw', 'YouTube video'],
    ['https://vimeo.com/76979871', 'Vimeo video'],
    ['https://loom.com/share/1234567890abcdef1234567890abcdef', 'Loom video'],
  ])('shows %s above the Reader title with description text', async (url, title) => {
    const { container } = renderReader({
      live: [makeLink({ ...a, url, extractedText: 'Video description.' })],
      route: '/?link=a',
    });
    await selected();
    const player = screen.getByTitle(title);
    const heading = reader().getByRole('heading', { name: 'First link' });
    expect(player.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(reader().getByText('Video description.')).toBeDefined();
    expect(player.getAttribute('referrerpolicy')).toBe('strict-origin-when-cross-origin');
    expect(player.getAttribute('allow')).toBe(
      'autoplay; encrypted-media; picture-in-picture; fullscreen',
    );
    expect(player.hasAttribute('allowfullscreen')).toBe(true);
    expect(player.hasAttribute('sandbox')).toBe(false);
    expect(container.querySelector('.silo-reader-prose')).toBeNull();
  });

  it('opens every newly selected link on Reader, even after Live was open', async () => {
    renderReader({ route: '/?link=a' });
    await waitFor(() =>
      expect(reader().getByRole('tab', { name: 'Reader' }).getAttribute('aria-selected')).toBe(
        'true',
      ),
    );
    expect(
      reader()
        .getAllByRole('tab')
        .map((tab) => tab.textContent),
    ).toEqual(['Reader', 'Live']);
    await selected();
    fireEvent.click(reader().getByRole('tab', { name: 'Live' }));
    fireEvent.click(screen.getByText('Second link'));
    await waitFor(() =>
      expect(reader().getByRole('tab', { name: 'Reader' }).getAttribute('aria-selected')).toBe(
        'true',
      ),
    );
  });

  it.each([
    ['https://youtube.com/watch?v=jNQXAC9IVRw', 'player'],
    ['https://paulgraham.com/greatwork.html', 'direct'],
    ['https://arxiv.org/pdf/1706.03762', 'direct'],
    ['https://downloads.test/archive.zip', 'card'],
  ])('selects Original mode for %s', async (url, mode) => {
    const { container } = renderReader({ live: [makeLink({ ...a, url })], route: '/?link=a' });
    await selected();
    fireEvent.click(reader().getByRole('tab', { name: 'Live' }));
    await waitFor(() =>
      expect(container.querySelector('.silo-original')?.getAttribute('data-mode')).toBe(mode),
    );
    expect(reader().getByRole('button', { name: 'Open original' })).toBeDefined();
    expect(reader().queryByLabelText(/^Original mode/)).toBeNull();
    const groups = container.querySelectorAll('.silo-reader-inline-actions .silo-reader-tools');
    const tools = [...(groups[groups.length - 1]?.children ?? [])];
    expect(tools.map((tool) => tool.getAttribute('aria-label'))).toEqual([
      'Copy link',
      'Open original',
      'Move to trash',
    ]);
    fireEvent.click(reader().getByRole('button', { name: 'More actions' }));
    expect(screen.getAllByRole('menuitem')[0]?.textContent).toBe('Edite');
    expect(screen.queryByRole('menuitem', { name: 'Reload page' }) !== null).toBe(
      mode !== 'player',
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    if (mode === 'direct') {
      expect(reader().queryByRole('button', { name: 'Show silo view' })).toBeNull();
      if (url.includes('/pdf/'))
        expect((await screen.findByTitle('Live page')).getAttribute('sandbox')).not.toContain(
          'allow-top-navigation',
        );
    }
  });

  it('switches the fallback card to the Reader tab', async () => {
    renderReader({
      live: [makeLink({ ...a, url: 'https://downloads.test/archive.zip' })],
      route: '/?link=a',
    });
    await selected();
    fireEvent.click(reader().getByRole('tab', { name: 'Live' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Show Reader' }));
    expect(reader().getByRole('tab', { name: 'Reader' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(await reader().findByText('First paragraph.')).toBeDefined();
  });

  it('shows one tweet card in Reader and only its themed embed in Original', async () => {
    const { container } = renderReader({
      live: [
        makeLink({
          ...a,
          url: 'https://x.com/karpathy/status/1886192184808149383',
          sourceData: twitterSourceData,
          extractedText: twitterSourceData.text,
        }),
      ],
      route: '/?link=a',
    });
    await selected();
    expect(reader().getAllByText(twitterSourceData.text)).toHaveLength(1);
    expect(container.querySelector('.silo-reader-body')).toBeNull();
    fireEvent.click(reader().getByRole('tab', { name: 'Live' }));
    expect(screen.getByTitle('X post').getAttribute('src')).toContain('theme=light');
    expect(container.querySelector('.silo-reader-tweet')).toBeNull();
    expect(reader().queryByText(twitterSourceData.text)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Dark mode' }));
    await waitFor(() =>
      expect(screen.getByTitle('X post').getAttribute('src')).toContain('theme=dark'),
    );
  });
});

describe('responsive reader header', () => {
  it('moves phone actions into More and keeps navigation in the header', async () => {
    const media = window.matchMedia;
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      ...media(query),
      matches: query === layoutMedia.phone || query === layoutMedia.fullWindowReader,
    }));
    const { container } = renderReader({ route: '/?link=a' });
    await selected();
    expect(reader().getByRole('button', { name: 'Close reader' })).toBeDefined();
    expect(reader().getByRole('button', { name: 'Previous' })).toBeDefined();
    expect(reader().getByRole('button', { name: 'Next' })).toBeDefined();
    expect(reader().queryByRole('button', { name: 'Copy link' })).toBeNull();
    expect(reader().queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(container.querySelector('.silo-reader-rbar')).toBeNull();
    expect(reader().getByRole('button', { name: 'View settings' })).toBeDefined();
    fireEvent.click(reader().getByRole('tab', { name: 'Live' }));
    await screen.findByTitle('Live page');
    fireEvent.click(reader().getByRole('button', { name: 'More actions' }));
    for (const name of ['Copy link', 'Reload page', 'Edit', 'Open original', 'Move to trash']) {
      expect(screen.getByRole('menuitem', { name: new RegExp(name) })).toBeDefined();
    }
    fireEvent.click(screen.getByRole('menuitem', { name: /Copy link/ }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(a.url));
  });

  it('keeps Trash reachable from the Library switcher while the sidebar is open, without repeating tags', async () => {
    renderReader();
    await screen.findByText('First link');
    fireEvent.click(screen.getByRole('button', { name: 'Library' }));
    expect(screen.getByRole('menuitem', { name: /Trash/ })).toBeDefined();
    expect(screen.queryByRole('menuitem', { name: /mcp/ })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: /Trash/ }));
    await waitFor(() => expect(screen.getByTestId('url').textContent).toBe('/trash'));
  });

  it('keeps tags reachable from the Library collection menu', async () => {
    localStorage.setItem('silo.sidebarCollapsed', 'true');
    renderReader();
    await screen.findByText('First link');
    fireEvent.click(screen.getByRole('button', { name: 'Library' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /mcp/ }));
    await waitFor(() => expect(screen.getByTestId('url').textContent).toBe('/tags/mcp'));
  });
});

it('opens phone tag management from the collection menu and restores focus on close', async () => {
  const media = window.matchMedia;
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    ...media(query),
    matches: query === layoutMedia.phone || query === layoutMedia.fullWindowReader,
  }));
  renderReader();
  await screen.findByText('First link');
  const collection = within(screen.getByRole('region', { name: 'Library links' })).getByRole(
    'button',
    { name: 'Library' },
  );
  fireEvent.click(collection);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Manage tags' }));
  expect(screen.getByRole('navigation', { name: 'Sidebar' }).getAttribute('data-open')).toBe(
    'true',
  );
  expect(screen.getByRole('button', { name: 'New tag' })).toBeDefined();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.getByRole('navigation', { name: 'Sidebar' }).getAttribute('data-open')).toBe(
    'false',
  );
  expect(document.activeElement).toBe(collection);
});

it('opens reader settings, persists widths, handles arrow keys, and returns focus on Escape', async () => {
  const { container } = renderReader();
  await screen.findByText('First link');
  expect(reader().queryByRole('button', { name: 'View settings' })).toBeNull();
  await selectFirst();
  const article = container.querySelector('article.silo-reader');
  expect(article?.getAttribute('data-width')).toBe('medium');
  const trigger = reader().getByRole('button', { name: 'View settings' });
  trigger.focus();
  fireEvent.click(trigger);
  expect(screen.getByRole('dialog', { name: 'View settings' })).toBeDefined();
  expect(screen.getByRole('region', { name: 'Reader' })).toBeDefined();
  expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Medium' }));
  for (const [label, value] of [
    ['Narrow', 'narrow'],
    ['Medium', 'medium'],
    ['Wide', 'wide'],
  ] as const) {
    fireEvent.click(screen.getByRole('radio', { name: label }));
    expect(article?.getAttribute('data-width')).toBe(value);
    expect(localStorage.getItem('silo.readerWidth')).toBe(value);
    expect(screen.getByRole('radiogroup', { name: 'Width' })).toBeDefined();
  }
  fireEvent.keyDown(screen.getByRole('radio', { name: 'Wide' }), { key: 'ArrowRight' });
  expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Narrow' }));
  expect(article?.getAttribute('data-width')).toBe('narrow');
  fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowUp' });
  expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Wide' }));
  expect(article?.getAttribute('data-width')).toBe('wide');
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  expect(screen.queryByRole('dialog', { name: 'View settings' })).toBeNull();
  expect(article).toBe(container.querySelector('article.silo-reader'));
  fireEvent.click(trigger);
  fireEvent.mouseDown(document.body);
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'View settings' })).toBeNull());
  fireEvent.click(reader().getByRole('tab', { name: 'Live' }));
  await waitFor(() => expect(reader().queryByRole('button', { name: 'View settings' })).toBeNull());
  expect(container.querySelector('.silo-original')?.hasAttribute('data-width')).toBe(false);
});

describe('Live header on scroll', () => {
  async function liveView() {
    const { container } = renderReader({ route: '/?link=a', frameHint: { mode: 'view' } });
    await selected();
    const tab = reader().getByRole('tab', { name: 'Live' });
    fireEvent.click(tab);
    const frame = (await screen.findByTitle('Silo view')) as HTMLIFrameElement;
    const report = (top: number) =>
      act(() => {
        window.dispatchEvent(
          new MessageEvent('message', {
            data: { type: 'silo:view-scroll', top, max: 4000, scroller: 1 },
            source: frame.contentWindow,
          }),
        );
      });
    return { head: container.querySelector('.silo-reader-head'), tab, report };
  }

  it('still hides after a mouse click leaves focus on the Live tab', async () => {
    const { head, tab, report } = await liveView();
    act(() => tab.focus());
    report(0);
    report(500);
    expect(head?.getAttribute('data-hidden')).toBe('true');
  });

  it('stays pinned while a header control has keyboard focus', async () => {
    const { head, tab, report } = await liveView();
    const matches = Element.prototype.matches;
    vi.spyOn(Element.prototype, 'matches').mockImplementation(function (
      this: Element,
      selector: string,
    ) {
      return selector === ':focus-visible' ? this === tab : matches.call(this, selector);
    });
    act(() => tab.focus());
    report(0);
    report(500);
    expect(head?.getAttribute('data-hidden')).toBe('false');
    vi.restoreAllMocks();
  });

  it('hides on Silo view scroll and reopens Live without replaying the slide', async () => {
    const { container } = renderReader({ route: '/?link=a', frameHint: { mode: 'view' } });
    await selected();
    fireEvent.click(reader().getByRole('tab', { name: 'Live' }));
    const frame = (await screen.findByTitle('Silo view')) as HTMLIFrameElement;
    const head = container.querySelector('.silo-reader-head');
    const scroll = container.querySelector('.silo-reader-scroll');
    const report = (top: number) =>
      act(() => {
        window.dispatchEvent(
          new MessageEvent('message', {
            data: { type: 'silo:view-scroll', top, max: 4000, scroller: 1 },
            source: frame.contentWindow,
          }),
        );
      });
    report(0);
    report(500);
    expect(head?.getAttribute('data-hidden')).toBe('true');
    expect(scroll?.getAttribute('data-head')).toBe('hidden');
    fireEvent.click(reader().getByRole('tab', { name: 'Reader' }));
    expect(head?.getAttribute('data-hidden')).toBe('false');
    fireEvent.click(reader().getByRole('tab', { name: 'Live' }));
    await screen.findByTitle('Silo view');
    expect(head?.getAttribute('data-hidden')).toBe('false');
    expect(scroll?.hasAttribute('data-head')).toBe(false);
  });
});

describe('Live page view settings', () => {
  it.each(['direct', 'view'] as const)(
    'toggles %s pages and retains the site opt-out across selection',
    async (mode) => {
      renderReader({ route: '/?link=a', frameHint: { mode, darkTheme: false } });
      await selected();
      expect(reader().queryByRole('switch', { name: 'Dark page' })).toBeNull();
      fireEvent.click(reader().getByRole('tab', { name: 'Live' }));
      await screen.findByTitle(mode === 'direct' ? 'Live page' : 'Silo view');
      expect(reader().queryByRole('switch', { name: 'Dark page' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Dark mode' }));
      fireEvent.click(await reader().findByRole('button', { name: 'View settings' }));
      expect(screen.getByRole('region', { name: 'Live page' })).toBeDefined();
      expect(screen.queryByRole('radiogroup', { name: 'Width' })).toBeNull();
      expect(screen.getByText('Recolour this site to match silo.')).toBeDefined();
      const toggle = screen.getByRole('switch', { name: 'Dark page' });
      expect(toggle.getAttribute('aria-checked')).toBe('true');
      const frame = screen.getByTitle(
        mode === 'direct' ? 'Live page' : 'Silo view',
      ) as HTMLIFrameElement;
      fireEvent.click(toggle);
      expect(toggle.getAttribute('aria-checked')).toBe('false');
      expect(frame.style.colorScheme).toBe('light');
      expect(localStorage.getItem('silo.lightPages')).toBe('["example.com"]');
      fireEvent.click(reader().getByRole('tab', { name: 'Reader' }));
      expect(reader().queryByRole('switch', { name: 'Dark page' })).toBeNull();
      fireEvent.click(screen.getByText('Second link'));
      await selected('Second link');
      fireEvent.click(reader().getByRole('tab', { name: 'Live' }));
      fireEvent.click(await reader().findByRole('button', { name: 'View settings' }));
      const persisted = screen.getByRole('switch', { name: 'Dark page' });
      expect(persisted.getAttribute('aria-checked')).toBe('false');
      fireEvent.click(persisted);
      expect(persisted.getAttribute('aria-checked')).toBe('true');
      expect(localStorage.getItem('silo.lightPages')).toBeNull();
    },
  );

  it.each([
    ['https://youtube.com/watch?v=jNQXAC9IVRw', 'YouTube video'],
    ['https://downloads.test/archive.zip', 'Show Reader'],
  ])('hides the toggle for %s', async (url, ready) => {
    renderReader({ live: [makeLink({ ...a, url })], route: '/?link=a' });
    await selected();
    fireEvent.click(screen.getByRole('button', { name: 'Dark mode' }));
    fireEvent.click(reader().getByRole('tab', { name: 'Live' }));
    await waitFor(() =>
      expect(
        screen.queryByTitle(ready) ?? screen.queryByRole('button', { name: ready }),
      ).not.toBeNull(),
    );
    expect(reader().queryByRole('button', { name: 'View settings' })).toBeNull();
  });

  it('keeps dark page settings reachable on phones and hides settings in Live light', async () => {
    const media = window.matchMedia;
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      ...media(query),
      matches: query === layoutMedia.phone || query === layoutMedia.fullWindowReader,
    }));
    renderReader({ route: '/?link=a', frameHint: { mode: 'direct', darkTheme: true } });
    await selected();
    fireEvent.click(screen.getByRole('button', { name: 'Dark mode' }));
    fireEvent.click(reader().getByRole('tab', { name: 'Live' }));
    fireEvent.click(await reader().findByRole('button', { name: 'View settings' }));
    const toggle = screen.getByRole('switch', { name: 'Dark page' });
    fireEvent.click(toggle);
    expect((screen.getByTitle('Live page') as HTMLIFrameElement).style.colorScheme).toBe('light');
    fireEvent.click(screen.getByRole('button', { name: 'Light mode' }));
    await waitFor(() =>
      expect(reader().queryByRole('button', { name: 'View settings' })).toBeNull(),
    );
    expect(screen.queryByRole('dialog', { name: 'View settings' })).toBeNull();
    expect((screen.getByTitle('Live page') as HTMLIFrameElement).style.colorScheme).toBe('');
  });
});
