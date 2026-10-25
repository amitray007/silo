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
  route = '/',
}: {
  live?: LinkJson[];
  trash?: TrashLinkJson[];
  extra?: LinkJson[];
  route?: string;
} = {}) {
  const state = { live: [...live], trash: [...trash], settings: { ...settings } };
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    const method = init?.method ?? 'GET';
    const url = new URL(path, 'https://silo.test');
    const reads: Record<string, () => Response> = {
      '/api/auth/check': () => json({ authRequired: false }),
      '/api/settings': () => json(state.settings),
      '/api/tags': () => json({ tags: [{ name: 'mcp', count: state.live.length }] }),
      '/api/counts': () =>
        json({ live: state.live.length, trash: state.trash.length, purgeWindowDays: 30 }),
      '/api/trash': () => json({ links: state.trash }),
      '/api/links': () => json({ links: state.live }),
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
    return link ? json({ link }) : json({ error: 'not_found', message: 'Unknown link' }, 404);
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
const selected = async (title = 'First link') =>
  waitFor(() => expect(reader().getByRole('heading', { level: 2, name: title })).toBeDefined());
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
  it('pushes URL selection, reuses loaded rows, and browser Back returns to the list', async () => {
    const { fetchMock, container } = renderReader();
    await selectFirst();
    expect(screen.getByTestId('url').textContent).toBe('/?link=a');
    expect(fetchMock.mock.calls.some(([path]) => String(path) === '/api/links/a')).toBe(false);
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
    fireEvent.click(reader().getByRole('tab', { name: 'Original' }));
    const frame = container.querySelector('iframe');
    expect(frame?.getAttribute('src')).toBe(a.url);
    expect(frame?.getAttribute('sandbox')).toBe(
      'allow-scripts allow-same-origin allow-popups allow-forms',
    );
    expect(frame?.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(frame?.getAttribute('loading')).toBe('lazy');
    expect(
      reader()
        .getByRole('link', { name: /Open in new tab/ })
        .getAttribute('href'),
    ).toBe(a.url);
    expect(reader().getByText(/Blank page\?/)).toBeDefined();
  });
  it('does not mount an unrequested Original iframe when selecting another link', async () => {
    const attributes = vi.spyOn(HTMLIFrameElement.prototype, 'setAttribute');
    const { container } = renderReader({ route: '/?link=a' });
    await selected();
    fireEvent.click(reader().getByRole('tab', { name: 'Original' }));
    fireEvent.click(within(reader().getByRole('toolbar')).getByRole('button', { name: 'Next' }));
    await selected('Second link');
    expect(container.querySelector('iframe')).toBeNull();
    expect(attributes).not.toHaveBeenCalledWith('src', b.url);
  });
  it('opens note and tag editing at the requested field', async () => {
    renderReader({ route: '/?link=a' });
    await selected();
    fireEvent.click(reader().getByRole('button', { name: 'Add a note' }));
    expect(document.activeElement).toBe(screen.getByPlaceholderText('Why you kept it'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(reader().getByRole('button', { name: 'Edit tags' }));
    expect(screen.getByPlaceholderText('Find or create a tag')).toBeDefined();
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
    expect(reader().getByRole('tab', { name: 'Original' }).getAttribute('aria-selected')).toBe(
      'true',
    );
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
    expect(screen.getByRole('dialog', { name: 'Edit item' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.keyDown(document, { key });
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/links/a/trash',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    await waitFor(() => expect(screen.getByTestId('url').textContent).toBe('/'));
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
    expect(screen.getByRole('dialog', { name: 'Edit item' })).toBeDefined();
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
