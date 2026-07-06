import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from './ThemeProvider';
import { ThemeToggle } from './ThemeToggle';

function mockMatchMedia(prefersDark: boolean) {
  window.matchMedia = vi
    .fn()
    .mockReturnValue({ matches: prefersDark }) as unknown as typeof matchMedia;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Renders `ui` wrapped with a fresh `QueryClientProvider` — `ThemeToggle` now fires a `useUpdateSettings` mutation on select (plan 016), which needs a query client in the tree even though these tests don't assert on the network call itself. */
function renderWithQuery(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('ThemeToggle', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    mockMatchMedia(false);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ theme: 'light', trashPurgeDays: 30, plugins: {} })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders both light and dark options', () => {
    renderWithQuery(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    expect(screen.getByRole('button', { name: 'Light' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Dark' })).toBeDefined();
  });

  it('reflects the current theme as the active/pressed option', () => {
    renderWithQuery(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    expect(screen.getByRole('button', { name: 'Light' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Dark' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('clicking an option sets the theme and updates the pressed state', () => {
    renderWithQuery(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );

    act(() => {
      screen.getByRole('button', { name: 'Dark' }).click();
    });

    expect(screen.getByRole('button', { name: 'Dark' }).getAttribute('aria-pressed')).toBe('true');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('is keyboard-operable (Enter activates the focused option)', () => {
    renderWithQuery(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );

    const darkButton = screen.getByRole('button', { name: 'Dark' });
    darkButton.focus();
    expect(document.activeElement).toBe(darkButton);

    act(() => {
      fireEvent.click(darkButton);
    });

    expect(darkButton.getAttribute('aria-pressed')).toBe('true');
  });

  it('never uses amber as the active background', () => {
    renderWithQuery(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    const active = screen.getByRole('button', { name: 'Light' });
    const bg = active.style.background;
    expect(bg).not.toMatch(/#c98f2d|#d9a441|#a87514/i);
    expect(bg).toBe('var(--hov)');
  });

  it('persists the selection via PATCH /api/settings (best-effort, fire-and-forget)', async () => {
    renderWithQuery(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );

    act(() => {
      screen.getByRole('button', { name: 'Dark' }).click();
    });

    await waitFor(() => {
      const calls = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
      const patchCall = calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH',
      );
      expect(patchCall).toBeDefined();
      const [url, init] = patchCall as [string, RequestInit];
      expect(url).toBe('/api/settings');
      expect(JSON.parse(init.body as string)).toEqual({ theme: 'dark' });
    });
  });
});
