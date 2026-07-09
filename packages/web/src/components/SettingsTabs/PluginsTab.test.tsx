import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PluginsTab } from './PluginsTab';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** The default `/api/settings` GET response, new plan-026 nested `plugins` shape (mirrors `SETTINGS_DEFAULTS`, `packages/core/src/settings/schema.ts`) — every field on, matching the server's all-on default. Includes `twitter` (un-parked from its static "Soon" card into a real toggle). */
function defaultSettings() {
  return {
    theme: 'system' as const,
    trashPurgeDays: 30 as const,
    plugins: {
      hacker_news: { enabled: true, inline: true, hover: true },
      github: { enabled: true, hover: true },
      youtube: { enabled: true, hover: true },
      twitter: { enabled: true, hover: true },
    },
  };
}

/**
 * Stateful fetch stub (mirrors `SettingsModal.test.tsx`'s `mockFetchRouter`)
 * — `useUpdateSettings`'s `onSettled` re-invalidates `settings` after every
 * PATCH, firing a follow-up GET; a stateless mock would hand that GET the
 * original defaults back, silently reverting whatever the PATCH just
 * "persisted." `initial` lets a test seed a non-default starting shape (e.g.
 * a source pre-disabled) to exercise the greyed-feature-toggle path without
 * needing an extra click first.
 */
function mockFetchRouter(initial = defaultSettings()) {
  let store = initial;
  const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/api/settings')) {
      if (init?.method === 'PATCH') {
        const patch = JSON.parse((init.body as string) ?? '{}');
        store = { ...store, ...patch };
        return Promise.resolve(jsonResponse(store));
      }
      return Promise.resolve(jsonResponse(store));
    }
    return Promise.resolve(jsonResponse({}));
  });
  return { fetchMock, getStore: () => store };
}

function renderTab(initial?: ReturnType<typeof defaultSettings>) {
  const { fetchMock, getStore } = mockFetchRouter(initial);
  vi.stubGlobal('fetch', fetchMock);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <PluginsTab />
    </QueryClientProvider>,
  );
  return { ...utils, fetchMock, getStore };
}

/**
 * The grid card button for a source — matched by accessible name, taking the
 * FIRST match. A source's name text also appears a second time once its
 * panel is expanded (the panel header repeats the name as plain text, not a
 * button), so `getByRole` alone is ambiguous whenever that source is
 * selected; the grid always renders before the panel in DOM order, so index
 * 0 is reliably the card.
 */
function getSourceCard(name: string | RegExp) {
  return screen.getAllByRole('button', { name })[0] as HTMLElement;
}

describe('PluginsTab (plan 026 — logo grid + expand panel)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders a 4-up grid with correct titles and status dots — all four are real toggles, no "Soon"', async () => {
    renderTab();

    // HN's panel is expanded by default, so its name appears twice (card +
    // panel header); each brand SVG's <title> also matches its own name by
    // text content — getAllByText (existence, not uniqueness) sidesteps both.
    expect(screen.getAllByText('Hacker News').length).toBeGreaterThan(0);
    expect(screen.getAllByText('GitHub').length).toBeGreaterThan(0);
    expect(screen.getAllByText('YouTube').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Twitter / X').length).toBeGreaterThan(0);
    expect(screen.queryByText('Soon')).toBeNull();

    // Each source card is a button with aria-expanded reflecting selection.
    const hnCard = getSourceCard(/Hacker News/i);
    expect(hnCard.getAttribute('aria-expanded')).toBe('true'); // selected by default
    const githubCard = getSourceCard(/^GitHub$/i);
    expect(githubCard.getAttribute('aria-expanded')).toBe('false');
    const twitterCard = getSourceCard(/Twitter \/ X/i);
    expect(twitterCard.getAttribute('aria-expanded')).toBe('false');

    await waitFor(() => expect(screen.getByTitle(/Hacker News is on/i)).toBeDefined());
  });

  it('HN is selected by default, showing its panel with inline + hover feature toggles', async () => {
    renderTab();

    await waitFor(() => expect(screen.getByTitle(/Hacker News is on/i)).toBeDefined());
    expect(screen.getByText('Inline on the row')).toBeDefined();
    expect(screen.getByText('On hover (preview card)')).toBeDefined();
  });

  it('clicking the GitHub card expands its panel showing hover-only (no inline toggle)', async () => {
    renderTab();

    fireEvent.click(getSourceCard(/^GitHub$/i));

    await waitFor(() => expect(screen.getByTitle(/GitHub is on/i)).toBeDefined());
    expect(screen.getByText('On hover (preview card)')).toBeDefined();
    expect(screen.queryByText('Inline on the row')).toBeNull();
  });

  it('clicking the YouTube card expands its panel showing hover-only (no inline toggle)', async () => {
    renderTab();

    fireEvent.click(getSourceCard(/^YouTube$/i));

    await waitFor(() => expect(screen.getByTitle(/YouTube is on/i)).toBeDefined());
    expect(screen.getByText('On hover (preview card)')).toBeDefined();
    expect(screen.queryByText('Inline on the row')).toBeNull();
  });

  it('clicking the Twitter/X card expands its panel showing hover-only (no inline toggle)', async () => {
    renderTab();

    fireEvent.click(getSourceCard(/Twitter \/ X/i));

    await waitFor(() => expect(screen.getByTitle(/Twitter \/ X is on/i)).toBeDefined());
    expect(screen.getByText('On hover (preview card)')).toBeDefined();
    expect(screen.queryByText('Inline on the row')).toBeNull();
    expect(screen.queryByText('Soon')).toBeNull();
  });

  it('toggling Twitter/X hover calls updateSettings with the full nested object, only twitter.hover flipped', async () => {
    const { fetchMock } = renderTab();

    fireEvent.click(getSourceCard(/Twitter \/ X/i));
    const hoverToggle = await screen.findByTitle(/On hover \(preview card\) is on/i);
    fireEvent.click(hoverToggle);

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(
        (call) => (call[1] as RequestInit | undefined)?.method === 'PATCH',
      );
      expect(patchCall).toBeDefined();
      const body = JSON.parse((patchCall?.[1] as RequestInit).body as string);
      expect(body).toEqual({
        plugins: {
          hacker_news: { enabled: true, inline: true, hover: true },
          github: { enabled: true, hover: true },
          youtube: { enabled: true, hover: true },
          twitter: { enabled: true, hover: false },
        },
      });
    });
  });

  it('toggling Twitter/X master off calls updateSettings with enabled:false and hover preserved', async () => {
    const { fetchMock } = renderTab();

    fireEvent.click(getSourceCard(/Twitter \/ X/i));
    const masterToggle = await screen.findByTitle(/Twitter \/ X is on/i);
    fireEvent.click(masterToggle);

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(
        (call) => (call[1] as RequestInit | undefined)?.method === 'PATCH',
      );
      expect(patchCall).toBeDefined();
      const body = JSON.parse((patchCall?.[1] as RequestInit).body as string);
      expect(body).toEqual({
        plugins: {
          hacker_news: { enabled: true, inline: true, hover: true },
          github: { enabled: true, hover: true },
          youtube: { enabled: true, hover: true },
          twitter: { enabled: false, hover: true },
        },
      });
    });
  });

  it('toggling HN master off calls updateSettings with enabled:false and inline/hover preserved (setPluginField output)', async () => {
    const { fetchMock } = renderTab();

    const hnToggle = await screen.findByTitle(/Hacker News is on/i);
    await waitFor(() => expect(hnToggle).not.toHaveProperty('disabled', true));

    fireEvent.click(hnToggle);

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(
        (call) => (call[1] as RequestInit | undefined)?.method === 'PATCH',
      );
      expect(patchCall).toBeDefined();
      const body = JSON.parse((patchCall?.[1] as RequestInit).body as string);
      expect(body).toEqual({
        plugins: {
          hacker_news: { enabled: false, inline: true, hover: true },
          github: { enabled: true, hover: true },
          youtube: { enabled: true, hover: true },
          twitter: { enabled: true, hover: true },
        },
      });
    });
  });

  it('toggling HN inline calls updateSettings with only inline flipped, enabled/hover untouched', async () => {
    const { fetchMock } = renderTab();

    const inlineToggle = await screen.findByTitle(/Inline on the row is on/i);
    fireEvent.click(inlineToggle);

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(
        (call) => (call[1] as RequestInit | undefined)?.method === 'PATCH',
      );
      expect(patchCall).toBeDefined();
      const body = JSON.parse((patchCall?.[1] as RequestInit).body as string);
      expect(body).toEqual({
        plugins: {
          hacker_news: { enabled: true, inline: false, hover: true },
          github: { enabled: true, hover: true },
          youtube: { enabled: true, hover: true },
          twitter: { enabled: true, hover: true },
        },
      });
    });
  });

  it('toggling GitHub hover calls updateSettings with the full nested object, only github.hover flipped', async () => {
    const { fetchMock } = renderTab();

    fireEvent.click(getSourceCard(/^GitHub$/i));
    const hoverToggle = await screen.findByTitle(/On hover \(preview card\) is on/i);
    fireEvent.click(hoverToggle);

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(
        (call) => (call[1] as RequestInit | undefined)?.method === 'PATCH',
      );
      expect(patchCall).toBeDefined();
      const body = JSON.parse((patchCall?.[1] as RequestInit).body as string);
      expect(body).toEqual({
        plugins: {
          hacker_news: { enabled: true, inline: true, hover: true },
          github: { enabled: true, hover: false },
          youtube: { enabled: true, hover: true },
          twitter: { enabled: true, hover: true },
        },
      });
    });
  });

  it('two quick toggles on the same source do NOT clobber each other (optimistic onMutate — plan 026 review fix)', async () => {
    // Regression for the read-modify-write race: without the optimistic cache
    // write in useUpdateSettings, both clicks would read the SAME stale
    // useSettings() snapshot and the second PATCH would drop the first's
    // change. Start from a mixed stored state so a clobber is visible, then
    // click inline then hover in quick succession WITHOUT awaiting between —
    // the second PATCH must carry BOTH flips.
    const { fetchMock } = renderTab({
      ...defaultSettings(),
      plugins: {
        hacker_news: { enabled: true, inline: false, hover: false },
        github: { enabled: true, hover: true },
        youtube: { enabled: true, hover: true },
        twitter: { enabled: true, hover: true },
      },
    });

    const inlineToggle = await screen.findByTitle(/Inline on the row is off/i);
    fireEvent.click(inlineToggle);
    const hoverToggle = await screen.findByTitle(/On hover \(preview card\) is off/i);
    fireEvent.click(hoverToggle);

    await waitFor(() => {
      const patchBodies = fetchMock.mock.calls
        .filter((call) => (call[1] as RequestInit | undefined)?.method === 'PATCH')
        .map((call) => JSON.parse((call[1] as RequestInit).body as string));
      // The LAST PATCH must reflect BOTH toggles on (inline was flipped first,
      // hover second) — proving the second click read the first's optimistic
      // update rather than the original stale snapshot.
      const last = patchBodies.at(-1);
      expect(last?.plugins.hacker_news).toEqual({ enabled: true, inline: true, hover: true });
    });
  });

  it('feature toggles are DISABLED while settings are still loading (no clobber via LOADING_PLUGINS — plan 026 review fix)', async () => {
    // Regression for the loading-window clobber: during the initial GET the
    // tab renders against the all-on LOADING_PLUGINS placeholder; a click on a
    // feature toggle then would rebuild the PATCH from placeholder values and
    // overwrite the user's real stored settings. The GET here never resolves,
    // so useSettings() stays loading and the inline toggle must be disabled.
    const neverResolves = new Promise<Response>(() => {});
    const fetchMock = vi.fn().mockReturnValue(neverResolves);
    vi.stubGlobal('fetch', fetchMock);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <PluginsTab />
      </QueryClientProvider>,
    );

    // HN's panel is open by default; its inline feature toggle exists but must
    // be disabled while loading (matching the master toggle's load-gate). A
    // disabled toggle's title is the generic "turn the source on first" form,
    // so match on the "Inline on the row" label prefix (present in every title
    // variant) rather than the "is on/off" copy.
    const inlineToggle = await screen.findByTitle(/^Inline on the row/i);
    expect(inlineToggle).toHaveProperty('disabled', true);

    // A click while disabled must fire NO PATCH.
    fireEvent.click(inlineToggle);
    const patched = fetchMock.mock.calls.some(
      (call) => (call[1] as RequestInit | undefined)?.method === 'PATCH',
    );
    expect(patched).toBe(false);
  });

  it('when a source is master-disabled, its feature toggles render disabled/greyed', async () => {
    renderTab({
      ...defaultSettings(),
      plugins: {
        hacker_news: { enabled: false, inline: true, hover: true },
        github: { enabled: true, hover: true },
        youtube: { enabled: true, hover: true },
        twitter: { enabled: true, hover: true },
      },
    });

    // A disabled feature toggle's title is the neutral "— unavailable" form
    // (shared by the master-off and loading cases) — wait for the settled
    // (disabled) render specifically so this doesn't assert against the
    // transient loading render.
    const inlineToggle = await screen.findByTitle(/Inline on the row — unavailable/i);
    expect(inlineToggle).toHaveProperty('disabled', true);
    const hoverToggle = screen.getByTitle(/On hover \(preview card\) — unavailable/i);
    expect(hoverToggle).toHaveProperty('disabled', true);
  });

  it('re-enabling a master-disabled source re-enables its feature toggles', async () => {
    renderTab({
      ...defaultSettings(),
      plugins: {
        hacker_news: { enabled: false, inline: true, hover: true },
        github: { enabled: true, hover: true },
        youtube: { enabled: true, hover: true },
        twitter: { enabled: true, hover: true },
      },
    });

    const masterToggle = await screen.findByTitle(/Hacker News is off/i);
    fireEvent.click(masterToggle);

    await waitFor(() => {
      const inlineToggle = screen.getByTitle(/Inline on the row/i);
      expect(inlineToggle).not.toHaveProperty('disabled', true);
    });
  });

  it('renders the footer note explaining plugins never change what gets saved', () => {
    renderTab();
    expect(screen.getByText(/plugins add inline detail/i)).toBeDefined();
  });
});
