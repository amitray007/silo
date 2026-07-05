import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeLink } from '../test/fixtures';
import { HoverPreviewProvider } from './HoverPreviewContext';
import { LinkRow } from './LinkRow';
import { RowMenuProvider } from './RowMenuContext';
import { SelectionProvider } from './SelectionContext';

function link(overrides: Parameters<typeof makeLink>[0] = {}) {
  return makeLink({ url: 'https://www.example.com/a-post', title: 'A post', ...overrides });
}

/** `LinkRow` reads `useRowMenu()` for its `⋯` button (plan 011, V3-4), `useLibrarySelection()` for its hover checkbox (V3-5), and `useHoverPreview()` for the hover-preview trigger (V3-8) — every render needs a `RowMenuProvider`, a `SelectionProvider`, and a `HoverPreviewProvider` ancestor; the `⋯` menu's tag hooks need a `QueryClientProvider` too. */
function renderRow(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <RowMenuProvider>
        <SelectionProvider>
          <HoverPreviewProvider>{ui}</HoverPreviewProvider>
        </SelectionProvider>
      </RowMenuProvider>
    </QueryClientProvider>,
  );
}

describe('LinkRow', () => {
  it('renders the title when present', () => {
    renderRow(<LinkRow link={link({ title: 'A post' })} />);
    expect(screen.getByText('A post')).toBeDefined();
  });

  it('falls back to the scheme-stripped url when title is null', () => {
    renderRow(<LinkRow link={link({ title: null, url: 'https://www.example.com/a-post' })} />);
    expect(screen.getByText('www.example.com/a-post')).toBeDefined();
  });

  it('renders the derived domain suffix (www. stripped)', () => {
    renderRow(<LinkRow link={link({ url: 'https://www.example.com/a-post' })} />);
    expect(screen.getByText('example.com')).toBeDefined();
  });

  it('is a real anchor to the link url, opening in a new tab safely', () => {
    renderRow(<LinkRow link={link({ url: 'https://example.com/x' })} />);
    const anchor = screen.getByRole('link') as HTMLAnchorElement;
    expect(anchor.getAttribute('href')).toBe('https://example.com/x');
    expect(anchor.getAttribute('target')).toBe('_blank');
    expect(anchor.getAttribute('rel')).toBe('noopener');
  });

  it('shows no mark glyph at all — marks were removed per user feedback (silence means complete, always)', () => {
    renderRow(<LinkRow link={link({ captureStatus: 'full', notes: null, addedBy: 'user' })} />);
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('dims the title while capturing, with no mark glyph', () => {
    renderRow(<LinkRow link={link({ captureStatus: 'enriching' })} />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('A post').style.color).toBe('var(--fnt)');
  });

  it('shows no mark glyph for a partial capture', () => {
    renderRow(<LinkRow link={link({ captureStatus: 'partial' })} />);
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('shows no mark glyph for a bare capture', () => {
    renderRow(<LinkRow link={link({ captureStatus: 'bare' })} />);
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('shows no note mark glyph when notes are present (only the note line, tested below)', () => {
    renderRow(<LinkRow link={link({ notes: 'read later' })} />);
    expect(screen.queryByLabelText('has a note')).toBeNull();
    expect(screen.getByText('"read later"')).toBeDefined();
  });

  it('shows no claude mark glyph when addedBy is agent', () => {
    renderRow(<LinkRow link={link({ addedBy: 'agent' })} />);
    expect(screen.queryByLabelText('added by Claude')).toBeNull();
  });

  it('shows the relative-time hover meta on hover, next to the domain', () => {
    renderRow(
      <LinkRow
        link={link({ title: 'A post', createdAt: new Date(Date.now() - 3600_000).toISOString() })}
      />,
    );
    const anchor = screen.getByRole('link', { name: /A post/ });
    expect(screen.queryByText('1h ago')).toBeNull();
    fireEvent.mouseEnter(anchor);
    expect(screen.getByText('1h ago')).toBeDefined();
    fireEvent.mouseLeave(anchor);
    expect(screen.queryByText('1h ago')).toBeNull();
  });

  it('renders the note line, quoted, only when notes are present', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <RowMenuProvider>
          <SelectionProvider>
            <HoverPreviewProvider>
              <LinkRow link={link({ notes: 'a comment' })} />
            </HoverPreviewProvider>
          </SelectionProvider>
        </RowMenuProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByText('"a comment"')).toBeDefined();

    rerender(
      <QueryClientProvider client={queryClient}>
        <RowMenuProvider>
          <SelectionProvider>
            <HoverPreviewProvider>
              <LinkRow link={link({ notes: null })} />
            </HoverPreviewProvider>
          </SelectionProvider>
        </RowMenuProvider>
      </QueryClientProvider>,
    );
    expect(screen.queryByText('"a comment"')).toBeNull();
  });

  it('treats empty-string notes like no note — no mark, no note line, no empty quotes', () => {
    // '' is falsy, so the guard (`link.notes && …`) must render nothing — not a
    // stray note mark or an empty `""`. Pins the behavior against a future
    // refactor to a null-only check.
    renderRow(<LinkRow link={link({ notes: '', captureStatus: 'full', addedBy: 'user' })} />);
    expect(screen.queryByLabelText('has a note')).toBeNull();
    expect(screen.queryByText('""')).toBeNull();
  });

  it('never uses the amber mark/markt color tokens anywhere in the row (no amber chrome — marks are gone)', () => {
    const { container } = renderRow(
      <LinkRow link={link({ notes: 'x', addedBy: 'agent', captureStatus: 'partial' })} />,
    );

    for (const el of container.querySelectorAll<HTMLElement>('*')) {
      const color = el.style.color;
      expect(color === 'var(--mark)' || color === 'var(--markt)').toBe(false);
    }
  });

  it('the ⋯ button opens the row menu without navigating (stopPropagation on mousedown+click)', () => {
    renderRow(<LinkRow link={link()} />);
    const optionsButton = screen.getByTitle('options');
    fireEvent.click(optionsButton);
    expect(screen.getByText('move to trash')).toBeDefined();
  });
});

/**
 * The hover-preview trigger (plan 011, V3-8) — v3's `it.enter`/`it.leave`
 * timing (`Silo-v3.html:813-822`: a 350ms show delay, a 140ms hide delay).
 * jsdom's `matchMedia` stub (`test-setup.ts`) defaults every query's
 * `matches` to `false`, which would make `isHoverCapable()` read `false` and
 * suppress the preview outright — these tests stub `matchMedia` themselves so
 * `(hover: hover)` reads `true`, matching a real desktop mouse.
 */
describe('LinkRow hover preview', () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    vi.useFakeTimers();
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(hover: hover)',
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof matchMedia;
  });

  afterEach(() => {
    vi.useRealTimers();
    window.matchMedia = originalMatchMedia;
  });

  it('shows the preview after the 350ms hover delay, not before', () => {
    renderRow(<LinkRow link={link({ title: 'Hover target' })} />);
    const anchor = screen.getByRole('link', { name: /Hover target/ });

    fireEvent.mouseEnter(anchor);
    expect(screen.queryByText('open ↗')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(349);
    });
    expect(screen.queryByText('open ↗')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByText('open ↗')).toBeDefined();
  });

  it('hides the preview after the 140ms leave delay once the pointer leaves the row', () => {
    renderRow(<LinkRow link={link()} />);
    const anchor = screen.getByRole('link');

    fireEvent.mouseEnter(anchor);
    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(screen.getByText('open ↗')).toBeDefined();

    fireEvent.mouseLeave(anchor);
    act(() => {
      vi.advanceTimersByTime(139);
    });
    expect(screen.getByText('open ↗')).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText('open ↗')).toBeNull();
  });

  it('a quick pass over the row (leave before the show delay elapses) never opens the preview', () => {
    renderRow(<LinkRow link={link()} />);
    const anchor = screen.getByRole('link');

    fireEvent.mouseEnter(anchor);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    fireEvent.mouseLeave(anchor);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByText('open ↗')).toBeNull();
  });

  it('moving from the row into the card cancels the pending hide (row→card handoff)', () => {
    renderRow(<LinkRow link={link()} />);
    const anchor = screen.getByRole('link');

    fireEvent.mouseEnter(anchor);
    act(() => {
      vi.advanceTimersByTime(350);
    });
    const card = screen.getByText('open ↗').closest('div[style*="position: fixed"]') as HTMLElement;
    expect(card).not.toBeNull();

    fireEvent.mouseLeave(anchor);
    fireEvent.mouseEnter(card);
    act(() => {
      vi.advanceTimersByTime(140);
    });
    // The hide that was scheduled on mouseLeave must have been cancelled by
    // entering the card — the preview stays open well past the hide delay.
    expect(screen.getByText('open ↗')).toBeDefined();

    fireEvent.mouseLeave(card);
    act(() => {
      vi.advanceTimersByTime(140);
    });
    expect(screen.queryByText('open ↗')).toBeNull();
  });

  it('is suppressed while this row’s ⋯ menu is open', () => {
    renderRow(<LinkRow link={link({ title: 'A post' })} />);
    fireEvent.click(screen.getByTitle('options'));
    expect(screen.getByText('move to trash')).toBeDefined();

    fireEvent.mouseEnter(screen.getByRole('link', { name: /A post/ }));
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByText('open ↗')).toBeNull();
  });

  it('opening the ⋯ menu while the preview is already showing dismisses it (after the hide delay)', () => {
    renderRow(<LinkRow link={link({ title: 'A post' })} />);
    const anchor = screen.getByRole('link', { name: /A post/ });

    fireEvent.mouseEnter(anchor);
    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(screen.getByText('open ↗')).toBeDefined();

    fireEvent.click(screen.getByTitle('options'));
    // The dismiss goes through the same `scheduleHide` path as a normal
    // mouse-leave (140ms) — opening the menu doesn't special-case an
    // instant close, it just guarantees a hide gets scheduled.
    act(() => {
      vi.advanceTimersByTime(140);
    });
    expect(screen.queryByText('open ↗')).toBeNull();
  });

  it('does not schedule a preview when the pointer is not hover-capable (coarse/touch)', () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof matchMedia;

    renderRow(<LinkRow link={link()} />);
    fireEvent.mouseEnter(screen.getByRole('link'));
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByText('open ↗')).toBeNull();
  });

  // Review fix (ce-correctness + ce-julik-frontend-races): a row can vanish
  // with no `mouseLeave` ever firing (trashed, or filtered out by a
  // refetch/edit while still hovered) — `LinkRow`'s unmount cleanup must
  // dismiss its own pending/showing preview immediately rather than leaving
  // an orphaned show-timer or a stale-content card behind.
  it('cancels an already-open preview immediately when the row unmounts (no lingering stale card)', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <RowMenuProvider>
          <SelectionProvider>
            <HoverPreviewProvider>
              <LinkRow link={link({ title: 'A post' })} />
            </HoverPreviewProvider>
          </SelectionProvider>
        </RowMenuProvider>
      </QueryClientProvider>,
    );

    fireEvent.mouseEnter(screen.getByRole('link', { name: /A post/ }));
    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(screen.getByText('open ↗')).toBeDefined();

    // Unmount the row WITHOUT firing mouseLeave first (simulates the row
    // disappearing out from under the pointer — e.g. trashed, or filtered
    // out by a list refetch — while still hovered) by re-rendering the
    // provider tree with no LinkRow child at all.
    rerender(
      <QueryClientProvider client={queryClient}>
        <RowMenuProvider>
          <SelectionProvider>
            <HoverPreviewProvider>
              <div>row removed</div>
            </HoverPreviewProvider>
          </SelectionProvider>
        </RowMenuProvider>
      </QueryClientProvider>,
    );

    // No hide delay to wait out — dismiss-on-unmount is immediate.
    expect(screen.queryByText('open ↗')).toBeNull();
  });

  it('cancels a pending (not-yet-shown) preview when the row unmounts before the show delay elapses', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <RowMenuProvider>
          <SelectionProvider>
            <HoverPreviewProvider>
              <LinkRow link={link({ title: 'A post' })} />
            </HoverPreviewProvider>
          </SelectionProvider>
        </RowMenuProvider>
      </QueryClientProvider>,
    );

    fireEvent.mouseEnter(screen.getByRole('link', { name: /A post/ }));
    act(() => {
      vi.advanceTimersByTime(200);
    });

    rerender(
      <QueryClientProvider client={queryClient}>
        <RowMenuProvider>
          <SelectionProvider>
            <HoverPreviewProvider>
              <div>row removed</div>
            </HoverPreviewProvider>
          </SelectionProvider>
        </RowMenuProvider>
      </QueryClientProvider>,
    );

    // Advance well past the 350ms show delay — the pending show timer must
    // have been cancelled by the unmount, so the preview never opens for a
    // link that's no longer on screen.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByText('open ↗')).toBeNull();
  });
});
