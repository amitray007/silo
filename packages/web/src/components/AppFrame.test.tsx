import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
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
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <MemoryRouter initialEntries={['/']}>
            <Routes>
              <Route element={<AppFrame />}>
                <Route path="/" element={<div>outlet content</div>} />
              </Route>
            </Routes>
          </MemoryRouter>
        </ThemeProvider>
      </QueryClientProvider>,
    );

    expect(screen.getByText('silo')).toBeDefined();
    expect(screen.getByRole('link', { name: /library/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /^light$/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /^dark$/i })).toBeDefined();
    expect(screen.getByText('outlet content')).toBeDefined();
  });
});
