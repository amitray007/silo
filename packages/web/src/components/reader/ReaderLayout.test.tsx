import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import type { LinkJson, SettingsMap, TrashLinkJson } from '../../api/types';
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
  details = {},
  route = '/',
  liveCount,
  trashCount,
  tagCount,
  pageSize = Infinity,
}: {
  live?: LinkJson[];
  trash?: TrashLinkJson[];
  extra?: LinkJson[];
  details?: Record<string, { contentHtml: string | null; contentImageCount: number }>;
  route?: string;
  liveCount?: number;
  trashCount?: number;
  tagCount?: number;
  pageSize?: number;
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
        [...state.live, ...extra].map((link) => [
          `/api/links/${link.id}/frame`,
          () => json({ mode: link.url.endsWith('.zip') ? 'none' : 'direct' }),
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
    const link = [...state.live, ...extra].find((link) => path === `/api/links/${link.id}`);
    return link
      ? json({ link: { ...link, contentHtml: null, contentImageCount: 0, ...details[link.id] } })
      : json({ error: 'not_found', message: 'Unknown link' }, 404);
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
/** Live is the default tab; content assertions switch to Reader first. */
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
    expect(reader().getByRole('status', { name: 'Capturing page' })).toBeDefined();
    expect(reader().getByText('◆ Added by Claude')).toBeDefined();
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
  it('renders the Original iframe with the required sandbox and an escape link', async () => {
    const { container } = renderReader({ route: '/?link=a' });
    await selected();
    fireEvent.click(reader().getByRole('tab', { name: 'Live' }));
    await waitFor(() => expect(container.querySelector('iframe')?.getAttribute('src')).toBe(a.url));
    const frame = container.querySelector('iframe');
    expect(frame?.getAttribute('sandbox')).toBeNull();
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
    fireEvent.click(
      within(reader().getByRole('toolbar')).getByRole('button', { name: 'Move to trash' }),
    );
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
    fireEvent.click(
      within(reader().getByRole('toolbar')).getByRole('button', { name: 'Move to trash' }),
    );
    await waitFor(() => expect(reader().getByRole('status').textContent).toBe('Try again later'));
    expect(screen.getByTestId('url').textContent).toBe('/?link=a');
    await selected();
  });
  it('keeps all phone toolbar actions wired, with bounded previous/next', async () => {
    const { fetchMock } = renderReader({ route: '/?link=a' });
    await selected();
    const toolbar = within(reader().getByRole('toolbar', { name: 'Reader actions' }));
    expect((toolbar.getByRole('button', { name: 'Previous' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(toolbar.getByRole('button', { name: 'Next' }));
    await selected('Second link');
    fireEvent.click(toolbar.getByRole('button', { name: 'Previous' }));
    await selected();
    fireEvent.click(toolbar.getByRole('button', { name: 'Copy link' }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(a.url));
    fireEvent.click(toolbar.getByRole('button', { name: 'Edit' }));
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
  it('restores trash from the phone toolbar', async () => {
    const { fetchMock } = renderReader({ trash: [makeTrashLink(a)], route: '/trash?link=a' });
    await selected();
    const toolbar = within(reader().getByRole('toolbar', { name: 'Reader actions' }));
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
      'Open originalo',
      'Copy linkc',
      'Edite',
      'Tags',
      'Select',
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
      matches: query.includes('min-width: 1100px'),
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
    expect(reader().getByText('No text was captured for this page.')).toBeDefined();
    expect(reader().getByRole('link', { name: 'Open original' }).getAttribute('href')).toBe(a.url);
    expect(reader().queryByRole('button', { name: 'Retry capture' })).toBeNull();
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
      fireEvent.click(within(row as HTMLElement).getByRole('button', { name: 'Options' }));
      fireEvent.click(screen.getByText('Move to trash'));
      await waitFor(() => expect(screen.getByTestId('url').textContent).toBe(url));
      if (nextTitle) await selected(nextTitle);
      fireEvent.click(screen.getByText('Browser back'));
      await waitFor(() => expect(screen.getByTestId('url').textContent).toBe('/'));
    },
  );

  it('selects a surviving neighbor after bulk removal, skipping removed neighbors', async () => {
    const c = makeLink({ id: 'c', title: 'Third link' });
    const { container } = renderReader({ live: [a, b, c] });
    await selectFirst();
    for (const id of ['a', 'b']) {
      const row = container.querySelector<HTMLElement>(`[data-link-id="${id}"]`);
      fireEvent.click(within(row as HTMLElement).getByRole('button', { name: 'Options' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Select' }));
    }
    fireEvent.click(
      within(container.querySelector('.silo-selection-dock') as HTMLElement).getByRole('button', {
        name: 'Move to trash',
      }),
    );
    await selected('Third link');
    expect(screen.getByTestId('url').textContent).toBe('/?link=c');
    fireEvent.click(screen.getByText('Browser back'));
    await waitFor(() => expect(screen.getByTestId('url').textContent).toBe('/'));
  });

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
    fireEvent.click(within(row as HTMLElement).getByRole('button', { name: 'Options' }));
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
    fireEvent.click(within(row as HTMLElement).getByRole('button', { name: 'Options' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete now' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm permanent deletion' }));
    await selected('Second link');
    expect(screen.getByTestId('url').textContent).toBe('/trash?link=b');
  });

  it('fetches the next page from the phone toolbar and advances past the loaded boundary', async () => {
    const media = window.matchMedia;
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      ...media(query),
      matches: query.includes('max-width: 719px'),
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

  it('closes one layer per Escape: row menu, selection, reader', async () => {
    const { container } = renderReader({ route: '/?link=a' });
    await selected();
    const row = container.querySelector<HTMLElement>('[data-link-id="a"]');
    const options = within(row as HTMLElement).getByRole('button', { name: 'Options' });
    fireEvent.click(options);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Select' }));
    fireEvent.click(options);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(options.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByText('1 selected')).toBeDefined();
    expect(screen.getByTestId('url').textContent).toBe('/?link=a');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('1 selected')).toBeNull();
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
    expect(reader().queryByRole('button', { name: 'Edit' })).toBeNull();
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
      matches: query.includes('max-width: 719px'),
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
  it('loads detail prose for a listed row, sanitizes it, and preserves API image indices', async () => {
    const { container, fetchMock } = renderReader({
      route: '/?link=a',
      details: {
        a: {
          contentHtml:
            '<h1>Article heading</h1><p style="color:red" onclick="bad()">Safe prose <a href="javascript:alert(1)">bad link</a><a href="https://react.dev">React docs</a></p><script>alert(1)</script><img src="https://cdn.test/a.png" onerror="bad()"><img src="https://cdn.test/a.png"><img src="https://cdn.test/extra.png"><pre><code>const a = 1;</code></pre><table><caption>Values</caption><tbody><tr><td>A</td></tr></tbody></table>',
          contentImageCount: 2,
        },
      },
    });
    await selected();
    await waitFor(() => expect(screen.getByText('Article heading')).toBeDefined());
    expect(fetchMock).toHaveBeenCalledWith('/api/links/a', expect.any(Object));
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

  it('opens every newly selected link on Live while listing Reader first', async () => {
    renderReader({ route: '/?link=a' });
    await waitFor(() =>
      expect(reader().getByRole('tab', { name: 'Live' }).getAttribute('aria-selected')).toBe(
        'true',
      ),
    );
    expect(
      reader()
        .getAllByRole('tab')
        .map((tab) => tab.textContent),
    ).toEqual(['Reader', 'Live']);
    await selected();
    fireEvent.click(screen.getByText('Second link'));
    await waitFor(() =>
      expect(reader().getByRole('tab', { name: 'Live' }).getAttribute('aria-selected')).toBe(
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
    const groups = container.querySelectorAll('.silo-reader-desktop .silo-reader-tools');
    const tools = [...(groups[groups.length - 1]?.children ?? [])];
    expect(tools.map((tool) => tool.getAttribute('aria-label')).slice(0, 2)).toEqual(
      mode === 'player' ? ['Copy link', 'Edit'] : ['Copy link', 'Refresh Live'],
    );
    if (mode === 'direct') {
      expect(reader().queryByRole('button', { name: 'Show silo view' })).toBeNull();
      if (url.includes('/pdf/'))
        expect((await screen.findByTitle('Live page')).hasAttribute('sandbox')).toBe(false);
    }
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
