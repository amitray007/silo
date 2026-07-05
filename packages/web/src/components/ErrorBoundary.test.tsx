import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

function Bomb(): never {
  throw new Error('boom');
}

describe('ErrorBoundary', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // React logs the error itself (dev overlay); our componentDidCatch also
    // logs it. Both are expected noise for this test — suppress it so the
    // test output stays legible without hiding a real assertion failure.
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('renders children normally when nothing throws', () => {
    render(
      <ErrorBoundary>
        <p>All is well</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('All is well')).toBeDefined();
  });

  it('renders the calm fallback instead of crashing when a child throws', () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeDefined();
    expect(screen.queryByText('All is well')).toBeNull();
  });

  it('logs the caught error for debugging', () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    const loggedOurError = consoleErrorSpy.mock.calls.some((call: unknown[]) =>
      call.some((arg) => arg instanceof Error && arg.message === 'boom'),
    );
    expect(loggedOurError).toBe(true);
  });
});
