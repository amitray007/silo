import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { TagMenu } from './TagMenu';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function mount() {
  const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { merge?: boolean };
    return body.merge
      ? new Response(JSON.stringify({ name: 'Existing', merged: true }), { status: 200 })
      : new Response(JSON.stringify({ error: 'tag_exists', message: 'Existing already exists.' }), {
          status: 409,
        });
  });
  vi.stubGlobal('fetch', fetch);
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
    >
      <MemoryRouter>
        <TagMenu tag="Old">
          <a href="/tags/Old">Old</a>
        </TagMenu>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return fetch;
}
it.each(['context', 'Shift+F10', 'ContextMenu'])('opens tag actions using %s', async (gesture) => {
  mount();
  const row = screen.getByRole('link', { name: 'Old' });
  if (gesture === 'context') fireEvent.contextMenu(row);
  else
    fireEvent.keyDown(row, {
      key: gesture === 'Shift+F10' ? 'F10' : 'ContextMenu',
      shiftKey: gesture === 'Shift+F10',
    });
  const menu = await screen.findByRole('menu', { name: 'Tag actions' });
  expect(
    within(menu)
      .getAllByRole('menuitem')
      .map((item) => item.textContent),
  ).toEqual(['Rename', 'Delete']);
});
it('asks before merging and sends merge only after confirmation', async () => {
  const fetch = mount();
  fireEvent.contextMenu(screen.getByRole('link', { name: 'Old' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }));
  const dialog = screen.getByRole('dialog', { name: 'Rename tag' });
  fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Existing' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
  const confirm = await screen.findByRole('alertdialog', { name: 'Merge tags?' });
  expect(confirm.textContent).toContain('Links keep their tags.');
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetch.mock.calls[0]?.[1]?.body as string).merge).toBe(false);
  fireEvent.click(within(confirm).getByRole('button', { name: 'Merge tags' }));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  expect(JSON.parse(fetch.mock.calls[1]?.[1]?.body as string).merge).toBe(true);
});
