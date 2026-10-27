import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { type ReactNode, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from '../api/hooks';
import type { SettingsMap } from '../api/types';
import { hackerNewsSourceData, makeLink, twitterSourceData } from '../test/fixtures';
import { HoverPreviewProvider, useHoverPreview } from './HoverPreviewContext';
import { LinkRow } from './LinkRow';
import { RowMenuProvider } from './RowMenuContext';

function link(overrides: Parameters<typeof makeLink>[0] = {}) {
  return makeLink({ url: 'https://www.example.com/a-post', title: 'A post', ...overrides });
}

/**
 * `LinkRow` reads `useRowMenu()` for its `⋯` button (plan 011, V3-4),
 * `useHoverPreview()`
 * for the hover-preview trigger (V3-8), and `useSettings()` for the HN
 * inline-line plugin gate (plan 026) — every render needs a `RowMenuProvider`,
 * a `HoverPreviewProvider` ancestor; the `⋯` menu's
 * tag hooks and `useSettings()` need a `QueryClientProvider` too.
 *
 * `plugins` seeds `queryKeys.settings()` in the cache so a test can exercise
 * the gate; when omitted, `useSettings()` stays in its loading state, which
 * exercises the `?? true` optimistic default (rich variant shows).
 */
const DEFAULT_PLUGINS: SettingsMap['plugins'] = {
  hacker_news: { enabled: true, inline: true, hover: true, palette: true },
  github: { enabled: true, hover: true, palette: true },
  youtube: { enabled: true, hover: true, palette: true },
  twitter: { enabled: true, inline: true, hover: true, palette: true },
};

function renderRow(ui: ReactNode, plugins?: SettingsMap['plugins'], hoverPreview?: boolean) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (plugins || hoverPreview !== undefined) {
    queryClient.setQueryData(queryKeys.settings(), {
      theme: 'system',
      trashPurgeDays: 30,
      mcpAccess: true,
      linkPreviewImages: true,
      hoverPreview: hoverPreview ?? false,
      plugins: plugins ?? DEFAULT_PLUGINS,
    } satisfies SettingsMap);
  }
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <RowMenuProvider>
        <HoverPreviewProvider>{ui}</HoverPreviewProvider>
      </RowMenuProvider>
    </QueryClientProvider>,
  );
  return { ...utils, queryClient };
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

  it('announces Capturing only to screen readers beneath an enriching title', () => {
    const { container } = renderRow(<LinkRow link={link({ captureStatus: 'enriching' })} />);
    expect(screen.getByText('Capturing').className).toBe('silo-sr-only');
    expect(container.querySelector('[data-enriching="true"]')).not.toBeNull();
    expect(screen.getByText('example.com')).toBeDefined();
    expect(screen.getByText('A post').className).toBe('silo-row-title');
  });

  it('keeps the favicon chip while enriching', () => {
    const { container } = renderRow(
      <LinkRow
        link={link({ captureStatus: 'enriching', title: null, url: 'https://www.example.com/a' })}
      />,
    );
    expect(container.querySelector('.silo-letter-chip img')?.getAttribute('src')).toBe(
      '/api/favicon?domain=example.com',
    );
    expect(screen.queryByLabelText('enriching')).toBeNull();
    expect(screen.getByText('www.example.com/a')).toBeDefined();
    expect(screen.getByText('example.com')).toBeDefined();
  });

  it('shows the favicon chip (not the loader) and the domain suffix once the row is full', () => {
    renderRow(<LinkRow link={link({ captureStatus: 'full' })} />);
    expect(screen.queryByLabelText('enriching')).toBeNull();
    expect(screen.queryByText('◌')).toBeNull();
    expect(screen.queryByText('Capturing')).toBeNull();
    // A settled row shows its domain suffix.
    expect(screen.getByText('example.com')).toBeDefined();
  });

  it('does NOT show the capturing chrome for partial or bare captures (only enriching pulses)', () => {
    const { rerender, container } = renderRow(
      <LinkRow link={link({ captureStatus: 'partial' })} />,
    );
    expect(screen.queryByText('Capturing')).toBeNull();

    rerender(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <RowMenuProvider>
          <HoverPreviewProvider>
            <LinkRow link={link({ captureStatus: 'bare' })} />
          </HoverPreviewProvider>
        </RowMenuProvider>
      </QueryClientProvider>,
    );
    expect(screen.queryByText('Capturing')).toBeNull();
    expect(container).toBeDefined();
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
          <HoverPreviewProvider>
            <LinkRow link={link({ notes: 'a comment' })} />
          </HoverPreviewProvider>
        </RowMenuProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByText('"a comment"')).toBeDefined();

    rerender(
      <QueryClientProvider client={queryClient}>
        <RowMenuProvider>
          <HoverPreviewProvider>
            <LinkRow link={link({ notes: null })} />
          </HoverPreviewProvider>
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
    const optionsButton = screen.getByTitle('Options');
    fireEvent.click(optionsButton);
    expect(screen.getByText('Move to trash')).toBeDefined();
  });

  it('right-clicking anywhere on the row opens the same options menu, suppressing the browser context menu', () => {
    renderRow(<LinkRow link={link({ title: 'A post' })} />);
    const anchor = screen.getByRole('link', { name: /A post/ });
    expect(screen.queryByRole('menuitem', { name: 'Move to trash' })).toBeNull();

    const event = fireEvent.contextMenu(anchor);

    // jsdom/RTL's fireEvent returns `false` when a handler called
    // preventDefault — this pins that the browser's own native context menu
    // was suppressed, not just that a menu happens to appear alongside it.
    expect(event).toBe(false);
    expect(screen.getByText('Move to trash')).toBeDefined();
    expect(screen.getByText('Open original')).toBeDefined();
  });

  it('right-clicking an already-open row toggles its menu closed (same toggleMenu path as ⋯)', () => {
    renderRow(<LinkRow link={link({ title: 'A post' })} />);
    const anchor = screen.getByRole('link', { name: /A post/ });

    fireEvent.contextMenu(anchor);
    expect(screen.getByText('Move to trash')).toBeDefined();

    fireEvent.contextMenu(anchor);
    expect(screen.queryByRole('menuitem', { name: 'Move to trash' })).toBeNull();
  });

  it('renders the ▲points·comments rich line for a Hacker News link (plan 012 phase 2)', () => {
    renderRow(<LinkRow link={link({ sourceData: hackerNewsSourceData })} />);
    expect(screen.getByText('342 points · 128 comments')).toBeDefined();
  });

  it('renders no rich line for a plain link', () => {
    renderRow(<LinkRow link={link({ sourceData: { kind: 'link' } })} />);
    expect(screen.queryByText(/points ·/)).toBeNull();
  });

  describe('HN inline plugin gate (plan 026)', () => {
    it('inline:false hides the points/comments line (but the row/title still renders)', () => {
      renderRow(<LinkRow link={link({ sourceData: hackerNewsSourceData })} />, {
        hacker_news: { enabled: true, inline: false, hover: true, palette: true },
        github: { enabled: true, hover: true, palette: true },
        youtube: { enabled: true, hover: true, palette: true },
        twitter: { enabled: true, inline: true, hover: true, palette: true },
      });
      expect(screen.queryByText('342 points · 128 comments')).toBeNull();
      expect(screen.getByText('A post')).toBeDefined();
    });

    it('inline:true shows the points/comments line', () => {
      renderRow(<LinkRow link={link({ sourceData: hackerNewsSourceData })} />, {
        hacker_news: { enabled: true, inline: true, hover: true, palette: true },
        github: { enabled: true, hover: true, palette: true },
        youtube: { enabled: true, hover: true, palette: true },
        twitter: { enabled: true, inline: true, hover: true, palette: true },
      });
      expect(screen.getByText('342 points · 128 comments')).toBeDefined();
    });

    it('enabled:false (master off) hides the points/comments line', () => {
      renderRow(<LinkRow link={link({ sourceData: hackerNewsSourceData })} />, {
        hacker_news: { enabled: false, inline: true, hover: true, palette: true },
        github: { enabled: true, hover: true, palette: true },
        youtube: { enabled: true, hover: true, palette: true },
        twitter: { enabled: true, inline: true, hover: true, palette: true },
      });
      expect(screen.queryByText('342 points · 128 comments')).toBeNull();
    });

    it('no settings seeded (loading): the line renders (optimistic ?? true default)', () => {
      renderRow(<LinkRow link={link({ sourceData: hackerNewsSourceData })} />);
      expect(screen.getByText('342 points · 128 comments')).toBeDefined();
    });
  });

  it('renders the tweet text inline line (no author prefix) for a Twitter/X link (command-center polish slice)', () => {
    renderRow(<LinkRow link={link({ sourceData: twitterSourceData })} />);
    expect(
      screen.getByText('Just shipped a new feature — thrilled with how it turned out.'),
    ).toBeDefined();
  });

  describe('Twitter inline plugin gate (command-center polish slice)', () => {
    it('inline:false hides the author/text line (but the row/title still renders)', () => {
      renderRow(<LinkRow link={link({ sourceData: twitterSourceData })} />, {
        hacker_news: { enabled: true, inline: true, hover: true, palette: true },
        github: { enabled: true, hover: true, palette: true },
        youtube: { enabled: true, hover: true, palette: true },
        twitter: { enabled: true, inline: false, hover: true, palette: true },
      });
      expect(
        screen.queryByText('Just shipped a new feature — thrilled with how it turned out.'),
      ).toBeNull();
      expect(screen.getByText('A post')).toBeDefined();
    });

    it('inline:true shows the author/text line', () => {
      renderRow(<LinkRow link={link({ sourceData: twitterSourceData })} />, {
        hacker_news: { enabled: true, inline: true, hover: true, palette: true },
        github: { enabled: true, hover: true, palette: true },
        youtube: { enabled: true, hover: true, palette: true },
        twitter: { enabled: true, inline: true, hover: true, palette: true },
      });
      expect(
        screen.getByText('Just shipped a new feature — thrilled with how it turned out.'),
      ).toBeDefined();
    });

    it('enabled:false (master off) hides the author/text line even when inline:true', () => {
      renderRow(<LinkRow link={link({ sourceData: twitterSourceData })} />, {
        hacker_news: { enabled: true, inline: true, hover: true, palette: true },
        github: { enabled: true, hover: true, palette: true },
        youtube: { enabled: true, hover: true, palette: true },
        twitter: { enabled: false, inline: true, hover: true, palette: true },
      });
      expect(
        screen.queryByText('Just shipped a new feature — thrilled with how it turned out.'),
      ).toBeNull();
    });

    it('no settings seeded (loading): the line renders (optimistic ?? true default)', () => {
      renderRow(<LinkRow link={link({ sourceData: twitterSourceData })} />);
      expect(
        screen.getByText('Just shipped a new feature — thrilled with how it turned out.'),
      ).toBeDefined();
    });
  });
});

/**
 * The hover-preview trigger (plan 011, V3-8) — a 160ms COLD show delay (v3's
 * single 350ms was split into warm/cold; see HoverPreviewContext) + a 140ms
 * hide delay. Tests that advance 350ms just to OPEN the preview before testing
 * something else are fine (350 > the 160ms cold delay).
 * jsdom's `matchMedia` stub (`test-setup.ts`) defaults every query's
 * `matches` to `false`, which would make `isHoverCapable()` read `false` and
 * suppress the preview outright — these tests stub `matchMedia` themselves so
 * `(hover: hover)` reads `true`, matching a real desktop mouse.
 */
describe('LinkRow hover preview', () => {
  function renderHoverRow(ui: ReactNode) {
    return renderRow(ui, DEFAULT_PLUGINS, true);
  }
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

  it.each([false, undefined])(
    'does not open or fetch a preview when hoverPreview is %s',
    (enabled) => {
      const fetchMock = vi.fn().mockReturnValue(new Promise<Response>(() => {}));
      vi.stubGlobal('fetch', fetchMock);
      try {
        renderRow(
          <LinkRow link={link({ imageUrl: 'https://example.com/cover.jpg' })} />,
          undefined,
          enabled,
        );
        const requestsBeforeHover = fetchMock.mock.calls.length;
        fireEvent.mouseEnter(screen.getByRole('link'));
        act(() => {
          vi.advanceTimersByTime(1000);
        });
        expect(screen.queryByRole('link', { name: 'Open' })).toBeNull();
        expect(document.querySelector('img[src*="preview-image"]')).toBeNull();
        expect(fetchMock.mock.calls.length).toBe(requestsBeforeHover);
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );

  it.each([100, 200])('turning previews off after %sms cancels a pending or open card', (delay) => {
    const { queryClient } = renderHoverRow(<LinkRow link={link()} />);
    fireEvent.mouseEnter(screen.getByRole('link'));
    act(() => {
      vi.advanceTimersByTime(delay);
    });
    expect(screen.queryByRole('link', { name: 'Open' }) !== null).toBe(delay >= 160);
    act(() => {
      queryClient.setQueryData(queryKeys.settings(), { hoverPreview: false });
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByRole('link', { name: 'Open' })).toBeNull();
  });

  it('mounting a list row while previews are off does not cancel a palette preview', () => {
    const paletteLink = link({ id: 'palette-link', title: 'Palette link' });
    function Harness() {
      const { scheduleShow } = useHoverPreview();
      const [showRow, setShowRow] = useState(false);
      return (
        <>
          <button type="button" onClick={() => scheduleShow(paletteLink, new DOMRect())}>
            Palette preview
          </button>
          <button type="button" onClick={() => setShowRow(true)}>
            Mount row
          </button>
          {showRow && <LinkRow link={paletteLink} />}
        </>
      );
    }
    renderRow(<Harness />, DEFAULT_PLUGINS, false);
    fireEvent.click(screen.getByRole('button', { name: 'Palette preview' }));
    act(() => {
      vi.advanceTimersByTime(100);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Mount row' }));
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.getByRole('link', { name: 'Open' }).getAttribute('href')).toBe(paletteLink.url);
  });

  it('shows the preview after the 160ms cold hover delay, not before', () => {
    // Cold delay: this is the FIRST hover (no preview open yet), so it uses
    // SHOW_DELAY_COLD_MS (160ms) — see HoverPreviewContext's warm/cold split.
    renderHoverRow(<LinkRow link={link({ title: 'Hover target' })} />);
    const anchor = screen.getByRole('link', { name: /Hover target/ });

    fireEvent.mouseEnter(anchor);
    expect(screen.queryByText('Open')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(159);
    });
    expect(screen.queryByText('Open')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByText('Open')).toBeDefined();
  });

  it('hides the preview after the 140ms leave delay once the pointer leaves the row', () => {
    renderHoverRow(<LinkRow link={link()} />);
    const anchor = screen.getByRole('link');

    fireEvent.mouseEnter(anchor);
    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(screen.getByText('Open')).toBeDefined();

    fireEvent.mouseLeave(anchor);
    act(() => {
      vi.advanceTimersByTime(139);
    });
    expect(screen.getByText('Open')).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText('Open')).toBeNull();
  });

  it('a quick pass over the row (leave before the show delay elapses) never opens the preview', () => {
    renderHoverRow(<LinkRow link={link()} />);
    const anchor = screen.getByRole('link');

    fireEvent.mouseEnter(anchor);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    fireEvent.mouseLeave(anchor);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByText('Open')).toBeNull();
  });

  it('moving from the row into the card cancels the pending hide (row→card handoff)', () => {
    renderHoverRow(<LinkRow link={link()} />);
    const anchor = screen.getByRole('link');

    fireEvent.mouseEnter(anchor);
    act(() => {
      vi.advanceTimersByTime(350);
    });
    const card = screen.getByText('Open').closest('div[style*="position: fixed"]') as HTMLElement;
    expect(card).not.toBeNull();

    fireEvent.mouseLeave(anchor);
    fireEvent.mouseEnter(card);
    act(() => {
      vi.advanceTimersByTime(140);
    });
    // The hide that was scheduled on mouseLeave must have been cancelled by
    // entering the card — the preview stays open well past the hide delay.
    expect(screen.getByText('Open')).toBeDefined();

    fireEvent.mouseLeave(card);
    act(() => {
      vi.advanceTimersByTime(140);
    });
    expect(screen.queryByText('Open')).toBeNull();
  });

  it('is suppressed while this row’s ⋯ menu is open', () => {
    renderHoverRow(<LinkRow link={link({ title: 'A post' })} />);
    fireEvent.click(screen.getByTitle('Options'));
    expect(screen.getByText('Move to trash')).toBeDefined();

    fireEvent.mouseEnter(screen.getByRole('link', { name: /A post/ }));
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByText('Open')).toBeNull();
  });

  it('opening the ⋯ menu while the preview is already showing dismisses it (after the hide delay)', () => {
    renderHoverRow(<LinkRow link={link({ title: 'A post' })} />);
    const anchor = screen.getByRole('link', { name: /A post/ });

    fireEvent.mouseEnter(anchor);
    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(screen.getByText('Open')).toBeDefined();

    fireEvent.click(screen.getByTitle('Options'));
    // The dismiss goes through the same `scheduleHide` path as a normal
    // mouse-leave (140ms) — opening the menu doesn't special-case an
    // instant close, it just guarantees a hide gets scheduled.
    act(() => {
      vi.advanceTimersByTime(140);
    });
    expect(screen.queryByText('Open')).toBeNull();
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

    renderHoverRow(<LinkRow link={link()} />);
    fireEvent.mouseEnter(screen.getByRole('link'));
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByText('Open')).toBeNull();
  });

  // Review fix (ce-correctness + ce-julik-frontend-races): a row can vanish
  // with no `mouseLeave` ever firing (trashed, or filtered out by a
  // refetch/edit while still hovered) — `LinkRow`'s unmount cleanup must
  // dismiss its own pending/showing preview immediately rather than leaving
  // an orphaned show-timer or a stale-content card behind.
  it('cancels an already-open preview immediately when the row unmounts (no lingering stale card)', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(queryKeys.settings(), { hoverPreview: true });
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <RowMenuProvider>
          <HoverPreviewProvider>
            <LinkRow link={link({ title: 'A post' })} />
          </HoverPreviewProvider>
        </RowMenuProvider>
      </QueryClientProvider>,
    );

    fireEvent.mouseEnter(screen.getByRole('link', { name: /A post/ }));
    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(screen.getByText('Open')).toBeDefined();

    // Unmount the row WITHOUT firing mouseLeave first (simulates the row
    // disappearing out from under the pointer — e.g. trashed, or filtered
    // out by a list refetch — while still hovered) by re-rendering the
    // provider tree with no LinkRow child at all.
    rerender(
      <QueryClientProvider client={queryClient}>
        <RowMenuProvider>
          <HoverPreviewProvider>
            <div>row removed</div>
          </HoverPreviewProvider>
        </RowMenuProvider>
      </QueryClientProvider>,
    );

    // No hide delay to wait out — dismiss-on-unmount is immediate.
    expect(screen.queryByText('Open')).toBeNull();
  });

  it('cancels a pending (not-yet-shown) preview when the row unmounts before the show delay elapses', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(queryKeys.settings(), { hoverPreview: true });
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <RowMenuProvider>
          <HoverPreviewProvider>
            <LinkRow link={link({ title: 'A post' })} />
          </HoverPreviewProvider>
        </RowMenuProvider>
      </QueryClientProvider>,
    );

    fireEvent.mouseEnter(screen.getByRole('link', { name: /A post/ }));
    act(() => {
      vi.advanceTimersByTime(100);
    });

    rerender(
      <QueryClientProvider client={queryClient}>
        <RowMenuProvider>
          <HoverPreviewProvider>
            <div>row removed</div>
          </HoverPreviewProvider>
        </RowMenuProvider>
      </QueryClientProvider>,
    );

    // Advance well past the 350ms show delay — the pending show timer must
    // have been cancelled by the unmount, so the preview never opens for a
    // link that's no longer on screen.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByText('Open')).toBeNull();
  });
});
