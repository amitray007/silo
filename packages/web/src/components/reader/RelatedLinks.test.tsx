import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LinkDetailJson } from '../../api/types';
import { makeLink } from '../../test/fixtures';
import { ReaderContent } from './ReaderContent';

const firstUrl = 'https://first.test/article';
const secondUrl = 'https://second.test/reference';
const html = `<p>Article body</p><a href="${firstUrl}">First article</a><a href="${secondUrl}">Reference guide</a>`;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
let saved: string[];
let titles: Record<string, string>;
let captureResponse: () => Promise<Response>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  saved = [];
  titles = {};
  captureResponse = async () => json({ link: makeLink({ url: firstUrl }), deduped: false }, 201);
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path === '/api/links/saved') return json({ saved });
    if (path === '/api/links/titles') return json({ titles });
    if (path === '/api/links') {
      const response = await captureResponse();
      if (response.ok) {
        const body = JSON.parse(String(init?.body)) as { url: string };
        saved = [...saved, body.url];
      }
      return response;
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function renderArticle(overrides: Partial<LinkDetailJson> = {}, trashed = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const link = {
    ...makeLink({ url: 'https://article.test/story' }),
    contentHtml: html,
    contentImageCount: 0,
    ...overrides,
  };
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <ReaderContent link={link} trashed={trashed} />
      </QueryClientProvider>,
    ),
  };
}

function section() {
  return screen.getByRole('region', { name: 'Related links' });
}

async function saveButton() {
  const button = within(section()).getAllByRole('button', { name: 'Save link' })[0];
  if (!button) throw new Error('Missing save button');
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  return button;
}

describe('Related links in Reader', () => {
  it('shows the real page title with the author link text beneath it', async () => {
    titles = { [firstUrl]: 'The First Article: A Guide', [secondUrl]: 'reference guide' };
    renderArticle();
    await within(section()).findByText('The First Article: A Guide');
    expect(within(section()).getByText('First article').className).toBe('silo-related-linktext');
    // A page title that only differs in case or punctuation adds no second line.
    expect(within(section()).getByText('reference guide').className).toBe('silo-related-title');
    expect(within(section()).queryByText('Reference guide')).toBeNull();
    const request = fetchMock.mock.calls.find(([path]) => path === '/api/links/titles');
    expect(JSON.parse(String(request?.[1]?.body))).toEqual({ urls: [firstUrl, secondUrl] });
  });

  it('does not fetch titles while the list is collapsed', async () => {
    localStorage.setItem('silo.relatedLinksOpen', 'false');
    renderArticle();
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([path]) => path === '/api/links/saved')).toBe(true),
    );
    expect(fetchMock.mock.calls.some(([path]) => path === '/api/links/titles')).toBe(false);
  });

  it('renders article rows with safe new-tab links and local favicon tiles', async () => {
    renderArticle();
    expect(screen.getByText('Article body')).toBeTruthy();
    const links = within(section()).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual([firstUrl, secondUrl]);
    expect(links[0]?.textContent).toBe('First article');
    expect(links[0]?.getAttribute('target')).toBe('_blank');
    expect(links[0]?.getAttribute('rel')).toBe('noopener noreferrer');
    const image = links[0]?.querySelector('img');
    expect(image?.getAttribute('src')).toBe('/api/favicon?domain=first.test');
    expect(image?.parentElement?.style.width).toBe('20px');
    await saveButton();
    expect(
      fetchMock.mock.calls.some(
        ([path, init]) =>
          path === '/api/links/saved' &&
          (init as RequestInit).body === JSON.stringify({ urls: [firstUrl, secondUrl] }),
      ),
    ).toBe(true);
  });

  it.each([null, '', '<p>No links</p>', '<a href="#part">Footnote</a>'])(
    'hides the section and makes no lookup for content %j',
    (contentHtml) => {
      renderArticle({ contentHtml });
      expect(screen.queryByRole('region', { name: 'Related links' })).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('hides the section for trashed articles', () => {
    renderArticle({}, true);
    expect(screen.queryByRole('region', { name: 'Related links' })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('starts expanded, persists collapse across remounts, and responds to storage changes', async () => {
    const view = renderArticle();
    const header = within(section()).getByRole('button', { name: 'Related links' });
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById(header.getAttribute('aria-controls') ?? '')?.tagName).toBe('UL');
    fireEvent.click(header);
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(localStorage.getItem('silo.relatedLinksOpen')).toBe('false');
    expect(within(section()).queryByRole('link')).toBeNull();
    view.unmount();
    renderArticle();
    expect(
      within(section())
        .getByRole('button', { name: 'Related links' })
        .getAttribute('aria-expanded'),
    ).toBe('false');
    act(() => {
      localStorage.setItem('silo.relatedLinksOpen', 'true');
      window.dispatchEvent(new StorageEvent('storage', { key: 'silo.relatedLinksOpen' }));
    });
    expect(within(section()).getAllByRole('link')).toHaveLength(2);
    await saveButton();
  });

  it('hides the bookmark for already-saved links while keeping their rows', async () => {
    saved = [firstUrl];
    renderArticle();
    await waitFor(() =>
      expect(within(section()).getAllByRole('button', { name: 'Save link' })).toHaveLength(1),
    );
    const row = within(section()).getByRole('link', { name: 'First article' }).closest('li');
    expect(row?.querySelector('button')).toBeNull();
    expect(row?.querySelector('.silo-related-action')).toBeTruthy();
  });

  it('disables while saving, shows filled success, invalidates lookup, and hides it on remount', async () => {
    let resolveCapture: (response: Response) => void = () => {};
    captureResponse = () =>
      new Promise((resolve) => {
        resolveCapture = resolve;
      });
    const view = renderArticle();
    const button = await saveButton();
    fireEvent.click(button);
    await waitFor(() => expect(button.getAttribute('aria-busy')).toBe('true'));
    expect((button as HTMLButtonElement).disabled).toBe(true);
    const request = fetchMock.mock.calls.find(([path]) => path === '/api/links');
    expect(JSON.parse(String((request?.[1] as RequestInit)?.body))).toEqual({
      url: firstUrl,
      source: 'web',
    });
    expect((request?.[1] as RequestInit)?.headers).toMatchObject({ 'X-Silo-CSRF': '1' });
    await act(async () => {
      resolveCapture(json({ link: makeLink({ url: firstUrl }), deduped: false }, 201));
    });
    const filled = await within(section()).findByRole('button', { name: 'Saved' });
    expect(filled.getAttribute('aria-pressed')).toBe('true');
    expect(filled.querySelector('svg')?.getAttribute('fill')).toBe('currentColor');
    await waitFor(() =>
      expect(fetchMock.mock.calls.filter(([path]) => path === '/api/links/saved').length).toBe(2),
    );
    expect(window.location.pathname).toBe('/');
    view.unmount();
    renderArticle();
    await waitFor(() =>
      expect(within(section()).getAllByRole('button', { name: 'Save link' })).toHaveLength(1),
    );
    expect(within(section()).queryByRole('button', { name: 'Saved' })).toBeNull();
  });

  it('treats a deduped capture as saved and removes confirmation after a short delay', async () => {
    captureResponse = async () => json({ link: makeLink({ url: firstUrl }), deduped: true }, 201);
    renderArticle();
    fireEvent.click(await saveButton());
    await within(section()).findByRole('button', { name: 'Saved' });
    await waitFor(
      () => expect(within(section()).queryByRole('button', { name: 'Saved' })).toBeNull(),
      { timeout: 2500 },
    );
    expect(within(section()).getAllByRole('button', { name: 'Save link' })).toHaveLength(1);
  });

  it('shows inline failure and retries without navigating', async () => {
    captureResponse = async () => json({ error: 'internal_error', message: 'Capture failed' }, 500);
    renderArticle();
    fireEvent.click(await saveButton());
    expect((await within(section()).findByRole('alert')).textContent).toBe("Couldn't save");
    expect(within(section()).getByText('Retry')).toBeTruthy();
    captureResponse = async () => json({ link: makeLink({ url: firstUrl }), deduped: false }, 201);
    fireEvent.click(await saveButton());
    await within(section()).findByRole('button', { name: 'Saved' });
    expect(within(section()).queryByRole('alert')).toBeNull();
    expect(window.location.pathname).toBe('/');
  });
});
