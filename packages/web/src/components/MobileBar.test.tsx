import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../auth/AuthContext';
import { layoutMedia } from '../lib/breakpoints';
import { ThemeProvider } from '../theme/ThemeProvider';
import { MobileBar } from './MobileBar';
import { SettingsProvider, useSettings } from './SettingsContext';

function Probe() {
  const { open } = useSettings();
  const location = useLocation();
  return <output>{open ? 'Settings open' : location.pathname}</output>;
}

function setup(phone = true) {
  const media = window.matchMedia;
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    ...media(query),
    matches: phone && query === layoutMedia.phone,
  }));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
  const onSearch = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ThemeProvider>
        <MemoryRouter>
          <AuthProvider>
            <SettingsProvider>
              <MobileBar onSearch={onSearch} />
              <Probe />
            </SettingsProvider>
          </AuthProvider>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return onSearch;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('phone bottom bar', () => {
  it('renders three named items and opens Search', () => {
    const onSearch = setup();
    const bar = within(screen.getByRole('navigation', { name: 'Phone navigation' }));
    expect(bar.getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual([
      'Library',
      'Search',
      'More',
    ]);
    fireEvent.click(bar.getByRole('button', { name: 'Search' }));
    expect(onSearch).toHaveBeenCalledOnce();
  });

  it('opens More upward with Trash, Settings, and the theme toggle', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('menuitem', { name: 'Trash' })).toBeDefined();
    expect(screen.getByRole('menuitem', { name: 'Settings' })).toBeDefined();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Dark mode' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('menuitem', { name: 'Light mode' })).toBeDefined();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Trash' }));
    expect(screen.getByRole('status').textContent).toBe('/trash');
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Settings' }));
    expect(screen.getByRole('status').textContent).toBe('Settings open');
  });

  it('does not render the bar above phone width', () => {
    setup(false);
    expect(screen.queryByRole('navigation')).toBeNull();
  });
});
