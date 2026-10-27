import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { layoutMedia } from '../lib/breakpoints';
import { ContentHeader } from './ContentHeader';

function renderCollection({ phone, sidebarHidden }: { phone: boolean; sidebarHidden: boolean }) {
  const media = window.matchMedia;
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    ...media(query),
    matches: phone && query === layoutMedia.phone,
  }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) =>
      Response.json(
        String(input).includes('/api/tags')
          ? { tags: [{ name: 'react', count: 3 }] }
          : { live: 4, trash: 2 },
      ),
    ),
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <Routes>
          <Route element={<Outlet context={{ showSidebar: () => {}, sidebarHidden }} />} path="*">
            <Route path="*" element={<ContentHeader title="Library" collection />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ContentHeader', () => {
  it('renders the title and count', () => {
    render(<ContentHeader title="Library" count={128} />);
    expect(screen.getByText('Library')).toBeDefined();
    expect(screen.getByText('128')).toBeDefined();
  });

  it('renders the title as a real heading (design-review pass — every route needs one navigable heading)', () => {
    render(<ContentHeader title="Library" count={128} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Library' })).toBeDefined();
  });

  it('renders without a count when omitted', () => {
    render(<ContentHeader title="Settings" />);
    expect(screen.getByText('Settings')).toBeDefined();
  });

  it('renders the children slot when given', () => {
    render(
      <ContentHeader title="Library">
        <button type="button">omnibar</button>
      </ContentHeader>,
    );
    expect(screen.getByRole('button', { name: /omnibar/i })).toBeDefined();
  });

  it('renders no phantom placeholder chrome when no children are given (K1 — silence means complete; TrashView/SettingsView pass no children)', () => {
    const { container } = render(<ContentHeader title="Trash" />);
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
  });

  it('renders no ◌ capturing chrome anywhere (removed per user feedback — no capturing UI)', () => {
    render(<ContentHeader title="Library" />);
    expect(screen.queryByText('◌')).toBeNull();
    expect(screen.queryByText(/capturing/)).toBeNull();
  });

  it('shows a calm capture-error message when captureError is set (plan 011, V3-3)', () => {
    render(<ContentHeader title="Library" captureError="Not a valid http(s) URL" />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain("Couldn't save that");
    expect(alert.textContent).toContain('Not a valid http(s) URL');
  });

  it('renders no capture-error chrome when captureError is omitted', () => {
    render(<ContentHeader title="Library" />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('offers Trash but not tags in the switcher while the docked sidebar is visible', async () => {
    renderCollection({ phone: false, sidebarHidden: false });
    fireEvent.click(screen.getByRole('button', { name: /Library/ }));
    expect(await screen.findByRole('menuitem', { name: /Trash/ })).toBeDefined();
    expect(screen.getByRole('menuitem', { name: /Library/ })).toBeDefined();
    expect(screen.queryByRole('menuitem', { name: /react/ })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /Manage tags/ })).toBeNull();
  });

  it('adds the tag list to the switcher when the sidebar is hidden', async () => {
    renderCollection({ phone: false, sidebarHidden: true });
    fireEvent.click(screen.getByRole('button', { name: /Library/ }));
    expect(await screen.findByRole('menuitem', { name: /react/ })).toBeDefined();
    expect(screen.getByRole('menuitem', { name: /Trash/ })).toBeDefined();
  });
});
