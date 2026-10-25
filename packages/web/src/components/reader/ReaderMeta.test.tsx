import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeLink } from '../../test/fixtures';
import { ReaderMeta } from './ReaderMeta';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function show(trashed = false) {
  const link = makeLink({
    id: 'meta',
    title: 'How to Work Hard',
    url: 'https://paulgraham.com/hwh.html',
    notes: 'Reread the section on effort.',
    tags: ['essays'],
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ReaderMeta link={link} trashed={trashed} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return link;
}
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/tags' && init?.method === 'POST')
        return json({ name: JSON.parse(init.body as string).name });
      if (url === '/api/tags')
        return json({
          tags: [
            { name: 'essays', count: 3 },
            { name: 'reading', count: 2 },
          ],
        });
      return json({
        link: makeLink({
          notes: init?.method === 'PATCH' ? JSON.parse(init.body as string).note : '',
        }),
      });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('Reader meta', () => {
  it.each(['blur', 'shortcut'])(
    'saves the note on %s and shows it before the request resolves',
    async (method) => {
      show();
      let complete: ((value: Response) => void) | undefined;
      vi.mocked(fetch).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            complete = resolve;
          }),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Edit note' }));
      const input = screen.getByRole('textbox', { name: 'Note' });
      fireEvent.change(input, { target: { value: 'Keep this paragraph.' } });
      if (method === 'blur') fireEvent.blur(input);
      else fireEvent.keyDown(input, { key: 'Enter', metaKey: true });
      expect(screen.getByText('Keep this paragraph.')).toBeDefined();
      await waitFor(() =>
        expect(fetch).toHaveBeenCalledWith(
          '/api/links/meta',
          expect.objectContaining({
            method: 'PATCH',
            body: JSON.stringify({ note: 'Keep this paragraph.' }),
          }),
        ),
      );
      await act(async () =>
        complete?.(json({ link: makeLink({ notes: 'Keep this paragraph.' }) })),
      );
      expect(screen.queryByRole('textbox', { name: 'Note' })).toBeNull();
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
  it('Escape cancels without saving, including a following blur', () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Edit note' }));
    const input = screen.getByRole('textbox', { name: 'Note' });
    fireEvent.change(input, { target: { value: 'Discard this.' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.blur(input);
    expect(screen.getByText('Reread the section on effort.')).toBeDefined();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rolls back the optimistic note and shows an error toast', async () => {
    show();
    vi.mocked(fetch).mockResolvedValueOnce(json({ error: 'server_error', message: 'Failed' }, 500));
    fireEvent.click(screen.getByRole('button', { name: 'Edit note' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), {
      target: { value: 'Unsaved note' },
    });
    fireEvent.blur(screen.getByRole('textbox', { name: 'Note' }));
    expect(screen.getByText('Unsaved note')).toBeDefined();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain("Couldn't save"));
    expect(screen.getByText('Reread the section on effort.')).toBeDefined();
  });
  it('adds, creates, and removes tags from the strip and keeps tag navigation', async () => {
    show();
    expect(screen.getByRole('link', { name: '#essays' }).getAttribute('href')).toBe('/tags/essays');
    fireEvent.click(screen.getByRole('button', { name: 'Tag' }));
    fireEvent.click(await screen.findByRole('option', { name: /reading/ }));
    await waitFor(() => expect(screen.getByRole('link', { name: '#reading' })).toBeDefined());
    const search = screen.getByPlaceholderText('Find or create tag');
    fireEvent.change(search, { target: { value: 'reference' } });
    fireEvent.click(screen.getByRole('option', { name: 'Create “reference”' }));
    await waitFor(() => expect(screen.getByRole('link', { name: '#reference' })).toBeDefined());
    expect(fetch).toHaveBeenCalledWith(
      '/api/tags',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: 'reference' }) }),
    );
    expect(fetch).toHaveBeenCalledWith(
      '/api/links/meta/tags',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ tag: 'reference' }) }),
    );
    fireEvent.change(search, { target: { value: '' } });
    const essays = screen.getByRole('option', { name: /essays/ });
    expect(essays.getAttribute('aria-selected')).toBe('true');
    fireEvent.click(essays);
    await waitFor(() => expect(screen.queryByRole('link', { name: '#essays' })).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Remove tag reading' }));
    await waitFor(() => expect(screen.queryByRole('link', { name: '#reading' })).toBeNull());
    expect(
      within(screen.getByRole('listbox'))
        .getByRole('option', { name: /reading/ })
        .getAttribute('aria-selected'),
    ).toBe('false');
  });
  it('does not expose edit controls for trashed links', () => {
    show(true);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Reread the section on effort.')).toBeDefined();
  });
});
