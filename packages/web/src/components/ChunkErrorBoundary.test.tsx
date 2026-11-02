import { render, screen } from '@testing-library/react';
import { lazy, Suspense } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { ChunkErrorBoundary } from './ChunkErrorBoundary';

afterEach(() => vi.restoreAllMocks());

it.each(['reader', 'settings', 'feed'] as const)('contains a rejected %s import', async (kind) => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const FailedChunk = lazy(() =>
    Promise.reject(new Error('Failed to fetch dynamically imported module')),
  );
  render(
    <>
      <p>App stays visible</p>
      <ChunkErrorBoundary kind={kind}>
        <Suspense fallback={<p>Loading chunk</p>}>
          <FailedChunk />
        </Suspense>
      </ChunkErrorBoundary>
    </>,
  );
  const { waitFor } = await import('@testing-library/react');
  await waitFor(() => expect(screen.queryByText('Loading chunk')).toBeNull());
  expect(screen.getByText('App stays visible')).toBeDefined();
  if (kind === 'reader') {
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  } else {
    expect(screen.getByRole('alert').textContent).toContain(
      kind === 'settings' ? 'Could not load this tab' : 'Could not load feeds',
    );
    expect(screen.getByRole('button', { name: 'Reload' })).toBeDefined();
  }
});
