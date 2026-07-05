import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../theme/ThemeProvider';
import { AppFrame } from './AppFrame';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function renderAppFrame(initialEntries: string[] = ['/']) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <MemoryRouter initialEntries={initialEntries}>
          <Routes>
            <Route element={<AppFrame />}>
              <Route path="/" element={<div>outlet content</div>} />
              <Route path="/trash" element={<div>trash content</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('AppFrame', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ live: 0, trash: 0, purgeWindowDays: 30 })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the sidebar, the theme toggle, and the routed outlet content', () => {
    renderAppFrame();

    expect(screen.getAllByText('silo').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /library/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /^light$/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /^dark$/i })).toBeDefined();
    expect(screen.getByText('outlet content')).toBeDefined();
  });

  it('the ☰ button starts closed with correct a11y wiring', () => {
    renderAppFrame();

    const menuButton = screen.getByRole('button', { name: /open menu/i });
    expect(menuButton.getAttribute('aria-expanded')).toBe('false');
    expect(menuButton.getAttribute('aria-controls')).toBe('silo-drawer');

    const drawer = screen.getByLabelText('Sidebar');
    expect(drawer.getAttribute('data-open')).toBe('false');
    expect(drawer.id).toBe('silo-drawer');
  });

  it('opens the drawer on ☰ click, flipping aria-expanded and data-open', () => {
    renderAppFrame();

    const menuButton = screen.getByRole('button', { name: /open menu/i });
    fireEvent.click(menuButton);

    expect(menuButton.getAttribute('aria-expanded')).toBe('true');
    expect(menuButton.getAttribute('aria-label')).toMatch(/close menu/i);
    const drawer = screen.getByLabelText('Sidebar');
    expect(drawer.getAttribute('data-open')).toBe('true');
  });

  it('moves focus into the drawer when it opens', () => {
    renderAppFrame();

    fireEvent.click(screen.getByRole('button', { name: /open menu/i }));

    const drawer = screen.getByLabelText('Sidebar');
    expect(document.activeElement).toBe(drawer);
  });

  it('closes the drawer on Escape and returns focus to the ☰ button', () => {
    renderAppFrame();

    const menuButton = screen.getByRole('button', { name: /open menu/i });
    fireEvent.click(menuButton);
    expect(screen.getByLabelText('Sidebar').getAttribute('data-open')).toBe('true');

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.getByLabelText('Sidebar').getAttribute('data-open')).toBe('false');
    expect(document.activeElement).toBe(menuButton);
  });

  it('closes the drawer when the scrim is clicked, returning focus to the ☰ button', () => {
    const { container } = renderAppFrame();

    const menuButton = screen.getByRole('button', { name: /open menu/i });
    fireEvent.click(menuButton);

    const scrim = container.querySelector('.silo-scrim');
    expect(scrim).not.toBeNull();
    fireEvent.click(scrim as Element);

    expect(screen.getByLabelText('Sidebar').getAttribute('data-open')).toBe('false');
    expect(menuButton.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(menuButton);
  });

  it('closes the drawer when a nav item is clicked (route change)', () => {
    renderAppFrame();

    fireEvent.click(screen.getByRole('button', { name: /open menu/i }));
    expect(screen.getByLabelText('Sidebar').getAttribute('data-open')).toBe('true');

    fireEvent.click(screen.getByRole('link', { name: /trash/i }));

    expect(screen.getByText('trash content')).toBeDefined();
    expect(screen.getByLabelText('Sidebar').getAttribute('data-open')).toBe('false');
  });
});
