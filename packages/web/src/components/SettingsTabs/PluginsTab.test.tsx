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

/** The default `/api/settings` GET response, new plan-026 nested `plugins` shape (mirrors `SETTINGS_DEFAULTS`, `packages/core/src/settings/schema.ts`) — every field on, matching the server's all-on default. */
function defaultSettings() {
  return {
    theme: 'system' as const,
    trashPurgeDays: 30 as const,
    plugins: {
      hacker_news: { enabled: true, inline: true, hover: true },
      github: { enabled: true, hover: true },
      youtube: { enabled: true, hover: true },
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

  it('renders a 4-up grid with correct titles and status dots (three "on", X "Soon")', async () => {
    renderTab();

    // HN's panel is expanded by default, so its name appears twice (card +
    // panel header); each brand SVG's <title> also matches its own name by
    // text content — getAllByText (existence, not uniqueness) sidesteps both.
    expect(screen.getAllByText('Hacker News').length).toBeGreaterThan(0);
    expect(screen.getAllByText('GitHub').length).toBeGreaterThan(0);
    expect(screen.getAllByText('YouTube').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Twitter / X').length).toBeGreaterThan(0);
    expect(screen.getByText('Soon')).toBeDefined();

    // Each source card is a button with aria-expanded reflecting selection.
    const hnCard = getSourceCard(/Hacker News/i);
    expect(hnCard.getAttribute('aria-expanded')).toBe('true'); // selected by default
    const githubCard = getSourceCard(/^GitHub$/i);
    expect(githubCard.getAttribute('aria-expanded')).toBe('false');

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

  it('clicking the X card shows a "coming soon" panel with no toggles', () => {
    renderTab();

    fireEvent.click(getSourceCard(/Twitter \/ X/i));

    expect(screen.getAllByText('Soon').length).toBeGreaterThan(0);
    expect(screen.queryByTitle(/Twitter.*is on/i)).toBeNull();
    expect(screen.queryByText('Inline on the row')).toBeNull();
    expect(screen.queryByText('On hover (preview card)')).toBeNull();
    expect(screen.getByText(/coming soon/i)).toBeDefined();
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
        },
      });
    });
  });

  it('when a source is master-disabled, its feature toggles render disabled/greyed', async () => {
    renderTab({
      ...defaultSettings(),
      plugins: {
        hacker_news: { enabled: false, inline: true, hover: true },
        github: { enabled: true, hover: true },
        youtube: { enabled: true, hover: true },
      },
    });

    // The loose title regex matches BOTH the loading-optimistic "is on" title
    // and the settled "turn the source on first" title — wait for the
    // settled (disabled) one specifically so this doesn't assert against the
    // transient loading render.
    const inlineToggle = await screen.findByTitle(/Inline on the row — turn the source on first/i);
    expect(inlineToggle).toHaveProperty('disabled', true);
    const hoverToggle = screen.getByTitle(/On hover \(preview card\) — turn the source on first/i);
    expect(hoverToggle).toHaveProperty('disabled', true);
  });

  it('re-enabling a master-disabled source re-enables its feature toggles', async () => {
    renderTab({
      ...defaultSettings(),
      plugins: {
        hacker_news: { enabled: false, inline: true, hover: true },
        github: { enabled: true, hover: true },
        youtube: { enabled: true, hover: true },
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
