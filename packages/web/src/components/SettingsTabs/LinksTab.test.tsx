import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LinkCleaning } from '../../api/types';
import { LinksTab } from './LinksTab';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const DEFAULTS: LinkCleaning = {
  enabled: true,
  everySite: ['utm_*', 'fbclid'],
  sites: [{ domain: 'youtube.com', strip: ['si'], keep: [] }],
};

/** Stateful `/api/settings`, so the refetch after each PATCH returns what was saved. */
function stubApi(initial: LinkCleaning) {
  let store: LinkCleaning = structuredClone(initial);
  const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.includes('/api/links/clean-preview')) {
      const { url: raw } = JSON.parse(String(init?.body));
      if (!raw.startsWith('http'))
        return Promise.resolve(jsonResponse({ error: 'bad_request', message: 'bad' }, 400));
      return Promise.resolve(
        jsonResponse({ url: raw.split('?')[0], originalUrl: raw, removed: ['utm_source'] }),
      );
    }
    if (url.includes('/api/links/clean-defaults')) return Promise.resolve(jsonResponse(DEFAULTS));
    if (method === 'PATCH') store = JSON.parse(String(init?.body)).linkCleaning;
    return Promise.resolve(jsonResponse({ theme: 'system', linkCleaning: store }));
  });
  vi.stubGlobal('fetch', fetchMock);
  const patches = () =>
    fetchMock.mock.calls
      .filter(([, init]) => init?.method === 'PATCH')
      .map(([, init]) => JSON.parse(String(init.body)).linkCleaning as LinkCleaning);
  return { patches, saved: () => store };
}

async function renderTab(initial: LinkCleaning = DEFAULTS) {
  const api = stubApi(initial);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <LinksTab />
    </QueryClientProvider>,
  );
  await screen.findByRole('switch', { name: 'Clean links' });
  return api;
}

const add = (label: string, value: string) => {
  fireEvent.change(screen.getByRole('textbox', { name: `Add to ${label}` }), {
    target: { value },
  });
  fireEvent.submit(screen.getByRole('form', { name: `Add to ${label}` }));
};

afterEach(() => vi.unstubAllGlobals());

describe('LinksTab', () => {
  it('toggle writes the setting', async () => {
    const api = await renderTab();
    fireEvent.click(screen.getByRole('switch', { name: 'Clean links' }));
    await waitFor(() => expect(api.patches()).toHaveLength(1));
    expect(api.patches()[0]?.enabled).toBe(false);
    expect(api.patches()[0]?.everySite).toEqual(['utm_*', 'fbclid']);
  });

  it('keeps the lists editable while cleaning is off', async () => {
    const api = await renderTab({ ...DEFAULTS, enabled: false });
    add('Every site', 'ref');
    await waitFor(() => expect(api.saved().everySite).toContain('ref'));
    expect(api.saved().enabled).toBe(false);
  });

  it('adds a pasted list of every-site params and removes one', async () => {
    const api = await renderTab();
    add('Every site', 'ref, gclid  mc_cid');
    await waitFor(() =>
      expect(api.saved().everySite).toEqual(['utm_*', 'fbclid', 'ref', 'gclid', 'mc_cid']),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Remove fbclid from Every site' }));
    await waitFor(() => expect(api.saved().everySite).not.toContain('fbclid'));
  });

  it('shows an inline error and saves nothing for a bad param name', async () => {
    const api = await renderTab();
    add('Every site', 'good, bad name!');
    expect((await screen.findByRole('alert')).textContent).toContain('“name!”');
    expect(api.patches()).toHaveLength(0);
  });

  it('adds a site with a normalized domain', async () => {
    const api = await renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Add site' }));
    const form = screen.getByRole('form', { name: 'New site rule' });
    fireEvent.change(within(form).getByRole('textbox', { name: 'Domain' }), {
      target: { value: ' HTTPS://www.Example.com:8080/path?x=1 ' },
    });
    fireEvent.submit(form);
    await waitFor(() =>
      expect(api.saved().sites.at(-1)).toEqual({ domain: 'example.com', strip: [], keep: [] }),
    );
  });

  it('rejects a duplicate or malformed domain inline', async () => {
    const api = await renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Add site' }));
    const form = screen.getByRole('form', { name: 'New site rule' });
    const field = within(form).getByRole('textbox', { name: 'Domain' });
    fireEvent.change(field, { target: { value: 'www.YouTube.com' } });
    fireEvent.submit(form);
    expect((await within(form).findByRole('alert')).textContent).toContain('already has a rule');
    fireEvent.change(field, { target: { value: 'localhost' } });
    fireEvent.submit(form);
    expect((await within(form).findByRole('alert')).textContent).toContain('not a domain');
    expect(api.patches()).toHaveLength(0);
  });

  it('edits a site: strip and keep chips, rename, then remove after a confirm', async () => {
    const api = await renderTab();
    add('youtube.com keep', 't');
    await waitFor(() => expect(api.saved().sites[0]?.keep).toEqual(['t']));
    add('youtube.com strip', 'feature');
    await waitFor(() => expect(api.saved().sites[0]?.strip).toEqual(['si', 'feature']));

    fireEvent.click(screen.getByRole('button', { name: 'Edit youtube.com' }));
    const form = screen.getByRole('form', { name: 'Rename youtube.com' });
    fireEvent.change(within(form).getByRole('textbox', { name: 'Domain' }), {
      target: { value: 'm.youtube.com' },
    });
    fireEvent.submit(form);
    await waitFor(() => expect(api.saved().sites[0]?.domain).toBe('m.youtube.com'));
    expect(api.saved().sites[0]?.keep).toEqual(['t']);

    fireEvent.click(await screen.findByRole('button', { name: 'Remove m.youtube.com' }));
    expect(api.saved().sites).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(api.saved().sites).toEqual([]));
  });

  it('resets to the defaults after a confirm', async () => {
    const api = await renderTab({ enabled: false, everySite: ['ref'], sites: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));
    expect(api.patches()).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(api.saved()).toEqual(DEFAULTS));
  });

  it('previews a link with the saved rules', async () => {
    await renderTab();
    fireEvent.change(screen.getByRole('textbox', { name: 'Link to try' }), {
      target: { value: 'https://example.com/a?utm_source=x' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Try' }));
    const result = await screen.findByText('https://example.com/a');
    expect(result.closest('[role="status"]')?.textContent).toContain('utm_source');
  });

  it('hides the preview when the input changes', async () => {
    await renderTab();
    const field = screen.getByRole('textbox', { name: 'Link to try' });
    fireEvent.change(field, { target: { value: 'https://example.com/a?utm_source=x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Try' }));
    await screen.findByText('https://example.com/a');
    fireEvent.change(field, { target: { value: 'https://example.com/b' } });
    expect(screen.queryByText('Cleaned link')).toBeNull();
  });

  it('shows a settings error and retries loading', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ message: 'Unavailable' }, 500));
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <LinksTab />
      </QueryClientProvider>,
    );
    expect((await screen.findByRole('alert')).textContent).toContain('Could not load');
    expect(screen.queryByRole('status')).toBeNull();
    fetchMock.mockResolvedValue(jsonResponse({ theme: 'system', linkCleaning: DEFAULTS }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByRole('switch', { name: 'Clean links' });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says so when the preview refuses the input', async () => {
    await renderTab();
    fireEvent.change(screen.getByRole('textbox', { name: 'Link to try' }), {
      target: { value: 'not a url' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Try' }));
    expect((await screen.findByRole('alert')).textContent).toContain('http');
  });
});
