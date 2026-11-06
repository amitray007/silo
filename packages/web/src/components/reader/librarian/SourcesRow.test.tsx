import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { SourcesRow } from './SourcesRow';

afterEach(() => vi.unstubAllGlobals());

const ONE = '00000000-0000-4000-8000-000000000001';
const TWO = '00000000-0000-4000-8000-000000000002';

function renderRow() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const id = String(input).includes(ONE) ? 1 : 2;
      return new Response(
        JSON.stringify({
          link: {
            url: `https://site${id}.com/post`,
            title: `Title ${id}`,
            createdAt: '2026-10-01T00:00:00.000Z',
          },
        }),
      );
    }),
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <SourcesRow answer={`[A](/?link=${ONE}) [B](/?link=${TWO})`} resolved={{}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it('opens a Sources menu with one item per resolved source', async () => {
  renderRow();
  const pill = await screen.findByRole('button', { name: '2 sources' });
  expect(pill.getAttribute('aria-haspopup')).toBe('menu');
  fireEvent.click(pill);
  const menu = screen.getByRole('menu', { name: 'Sources' });
  expect(menu.closest('.silo-sources')).toBeNull();
  expect(screen.getAllByRole('menuitem').map((item) => item.getAttribute('href'))).toEqual([
    `/?link=${ONE}`,
    `/?link=${TWO}`,
  ]);
});

it('closes on Escape and on choosing a source', async () => {
  renderRow();
  const pill = await screen.findByRole('button', { name: '2 sources' });
  fireEvent.click(pill);
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  expect(pill.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(pill);
  fireEvent.click(screen.getAllByRole('menuitem')[0] as HTMLElement);
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
});
