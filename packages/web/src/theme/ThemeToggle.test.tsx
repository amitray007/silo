import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from './ThemeProvider';
import { ThemeToggle } from './ThemeToggle';

function mockMatchMedia(prefersDark: boolean) {
  window.matchMedia = vi
    .fn()
    .mockReturnValue({ matches: prefersDark }) as unknown as typeof matchMedia;
}

describe('ThemeToggle', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    mockMatchMedia(false);
  });

  it('renders both light and dark options', () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    expect(screen.getByRole('button', { name: 'Light' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Dark' })).toBeDefined();
  });

  it('reflects the current theme as the active/pressed option', () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    expect(screen.getByRole('button', { name: 'Light' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Dark' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('clicking an option sets the theme and updates the pressed state', () => {
    render(
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
    render(
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
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    const active = screen.getByRole('button', { name: 'Light' });
    const bg = active.style.background;
    expect(bg).not.toMatch(/#c98f2d|#d9a441|#a87514/i);
    expect(bg).toBe('var(--hov)');
  });
});
