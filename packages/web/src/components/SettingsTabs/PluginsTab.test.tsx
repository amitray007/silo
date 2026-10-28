import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PluginsTab } from './PluginsTab';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// Settings response with every source surface enabled.
function defaultSettings() {
  return {
    theme: 'system' as const,
    trashPurgeDays: 30 as const,
    linkPreviewImages: true,
    hoverPreview: false,
    plugins: {
      hacker_news: { enabled: true, inline: true, hover: true, palette: true },
      github: { enabled: true, hover: true, palette: true },
      youtube: { enabled: true, hover: true, palette: true },
      twitter: { enabled: true, inline: true, hover: true, palette: true },
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

function getSourceButton(name: string | RegExp) {
  return screen.getByRole('button', { name });
}

function sourceSummary(name: string | RegExp) {
  const id = getSourceButton(name).getAttribute('aria-describedby');
  return document.getElementById(id ?? '')?.textContent;
}

describe('PluginsTab source disclosures', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders four unique source rows, master switches, and all disclosures collapsed', async () => {
    renderTab();
    expect(screen.getByRole('heading', { name: 'Sources' })).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Silo' })).toBeDefined();
    await screen.findByTitle(/Hacker News is on/i);
    for (const name of ['Hacker News', 'GitHub', 'YouTube', 'Twitter / X']) {
      const body = getSourceButton(name);
      expect(within(body).getByText(name, { selector: 'span' })).toBeDefined();
      expect(body.getAttribute('aria-expanded')).toBe('false');
      expect(screen.getByRole('switch', { name }).getAttribute('aria-checked')).toBe('true');
      const disclosure = getSourceButton(`Expand ${name} features`);
      expect(disclosure.getAttribute('aria-expanded')).toBe('false');
      const panel = document.getElementById(disclosure.getAttribute('aria-controls') ?? '');
      expect(panel?.hidden).toBe(true);
    }
    expect(screen.queryByText('Inline on the row')).toBeNull();
    expect(screen.queryByText('Soon')).toBeNull();
  });

  it('opens from the row body, collapses from the chevron, and keeps only one source open', () => {
    renderTab();
    fireEvent.click(getSourceButton('Hacker News'));
    expect(getSourceButton('Collapse Hacker News features').getAttribute('aria-expanded')).toBe(
      'true',
    );
    expect(screen.getByRole('switch', { name: 'Inline on the row' })).toBeDefined();
    fireEvent.click(getSourceButton('Expand GitHub features'));
    expect(getSourceButton('Hacker News').getAttribute('aria-expanded')).toBe('false');
    expect(getSourceButton('GitHub').getAttribute('aria-expanded')).toBe('true');
    expect(screen.queryByText('Inline on the row')).toBeNull();
    fireEvent.click(getSourceButton('Collapse GitHub features'));
    expect(getSourceButton('GitHub').getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('On hover (preview card)')).toBeNull();
  });

  it('summarizes enabled surfaces and updates the summary when a feature changes', async () => {
    renderTab();
    await screen.findByTitle(/Hacker News is on/i);
    expect(sourceSummary('Hacker News')).toBe('Row, hover card, ⌘K');
    expect(sourceSummary('GitHub')).toBe('Hover card, ⌘K');
    fireEvent.click(getSourceButton('Hacker News'));
    fireEvent.click(screen.getByRole('switch', { name: 'Inline on the row' }));
    await waitFor(() => expect(sourceSummary('Hacker News')).toBe('Hover card, ⌘K'));
  });

  it('shows Off without expanding when a master switch is turned off', async () => {
    const { getStore } = renderTab();
    fireEvent.click(await screen.findByTitle(/Hacker News is on/i));
    await waitFor(() => expect(sourceSummary('Hacker News')).toBe('Off'));
    expect(getSourceButton('Hacker News').getAttribute('aria-expanded')).toBe('false');
    expect(getStore().plugins.hacker_news).toEqual({
      enabled: false,
      inline: true,
      hover: true,
      palette: true,
    });
  });

  it('keeps the open disclosure when its master switch changes', async () => {
    renderTab();
    await screen.findByTitle(/Hacker News is on/i);
    fireEvent.click(getSourceButton('Hacker News'));
    fireEvent.click(screen.getByRole('switch', { name: 'Hacker News' }));
    await waitFor(() => expect(sourceSummary('Hacker News')).toBe('Off'));
    expect(getSourceButton('Hacker News').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('switch', { name: 'Inline on the row' })).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('writes only the changed palette field and updates its summary', async () => {
    const { getStore } = renderTab();
    await screen.findByTitle(/GitHub is on/i);
    fireEvent.click(getSourceButton('GitHub'));
    fireEvent.click(screen.getByRole('switch', { name: 'In the command palette' }));
    await waitFor(() => expect(sourceSummary('GitHub')).toBe('Hover card'));
    expect(getStore().plugins).toEqual({
      ...defaultSettings().plugins,
      github: { enabled: true, hover: true, palette: false },
    });
  });

  it('shows No surfaces on for an enabled source with all features off', async () => {
    const settings = defaultSettings();
    settings.plugins.hacker_news = { enabled: true, inline: false, hover: false, palette: false };
    renderTab(settings);
    await waitFor(() => expect(sourceSummary('Hacker News')).toBe('No surfaces on'));
  });

  it('expands GitHub features without an inline toggle', async () => {
    renderTab();

    fireEvent.click(getSourceButton(/^GitHub$/i));

    await waitFor(() => expect(screen.getByTitle(/GitHub is on/i)).toBeDefined());
    expect(screen.getByText('On hover (preview card)')).toBeDefined();
    expect(screen.queryByText('Inline on the row')).toBeNull();
  });

  it('expands YouTube features without an inline toggle', async () => {
    renderTab();

    fireEvent.click(getSourceButton(/^YouTube$/i));

    await waitFor(() => expect(screen.getByTitle(/YouTube is on/i)).toBeDefined());
    expect(screen.getByText('On hover (preview card)')).toBeDefined();
    expect(screen.queryByText('Inline on the row')).toBeNull();
  });

  it('expands Twitter / X with inline, hover, and palette toggles', async () => {
    renderTab();

    fireEvent.click(getSourceButton(/^Twitter \/ X$/i));

    await waitFor(() => expect(screen.getByTitle(/Twitter \/ X is on/i)).toBeDefined());
    expect(screen.getByText('On hover (preview card)')).toBeDefined();
    expect(screen.getByText('Inline on the row')).toBeDefined();
    expect(screen.queryByText('Soon')).toBeNull();
  });

  it('toggling Twitter/X hover calls updateSettings with the full nested object, only twitter.hover flipped', async () => {
    const { fetchMock } = renderTab();

    fireEvent.click(getSourceButton(/^Twitter \/ X$/i));
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
          hacker_news: { enabled: true, inline: true, hover: true, palette: true },
          github: { enabled: true, hover: true, palette: true },
          youtube: { enabled: true, hover: true, palette: true },
          twitter: { enabled: true, inline: true, hover: false, palette: true },
        },
      });
    });
  });

  it('toggling Twitter/X inline calls updateSettings with only twitter.inline flipped, enabled/hover untouched', async () => {
    const { fetchMock } = renderTab();

    fireEvent.click(getSourceButton(/^Twitter \/ X$/i));
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
          hacker_news: { enabled: true, inline: true, hover: true, palette: true },
          github: { enabled: true, hover: true, palette: true },
          youtube: { enabled: true, hover: true, palette: true },
          twitter: { enabled: true, inline: false, hover: true, palette: true },
        },
      });
    });
  });

  it('toggling Twitter/X master off calls updateSettings with enabled:false and hover preserved', async () => {
    const { fetchMock } = renderTab();

    fireEvent.click(getSourceButton(/^Twitter \/ X$/i));
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
          hacker_news: { enabled: true, inline: true, hover: true, palette: true },
          github: { enabled: true, hover: true, palette: true },
          youtube: { enabled: true, hover: true, palette: true },
          twitter: { enabled: false, inline: true, hover: true, palette: true },
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
          hacker_news: { enabled: false, inline: true, hover: true, palette: true },
          github: { enabled: true, hover: true, palette: true },
          youtube: { enabled: true, hover: true, palette: true },
          twitter: { enabled: true, inline: true, hover: true, palette: true },
        },
      });
    });
  });

  it('toggling HN inline calls updateSettings with only inline flipped, enabled/hover untouched', async () => {
    const { fetchMock } = renderTab();

    fireEvent.click(getSourceButton('Hacker News'));
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
          hacker_news: { enabled: true, inline: false, hover: true, palette: true },
          github: { enabled: true, hover: true, palette: true },
          youtube: { enabled: true, hover: true, palette: true },
          twitter: { enabled: true, inline: true, hover: true, palette: true },
        },
      });
    });
  });

  it('toggling GitHub hover calls updateSettings with the full nested object, only github.hover flipped', async () => {
    const { fetchMock } = renderTab();

    fireEvent.click(getSourceButton(/^GitHub$/i));
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
          hacker_news: { enabled: true, inline: true, hover: true, palette: true },
          github: { enabled: true, hover: false, palette: true },
          youtube: { enabled: true, hover: true, palette: true },
          twitter: { enabled: true, inline: true, hover: true, palette: true },
        },
      });
    });
  });

  it('preserves both changes when two features are toggled quickly', async () => {
    // Regression for the read-modify-write race: without the optimistic cache
    // write in useUpdateSettings, both clicks would read the SAME stale
    // useSettings() snapshot and the second PATCH would drop the first's
    // change. Start from a mixed stored state so a clobber is visible, then
    // click inline then hover in quick succession WITHOUT awaiting between —
    // the second PATCH must carry BOTH flips.
    const { fetchMock } = renderTab({
      ...defaultSettings(),
      plugins: {
        hacker_news: { enabled: true, inline: false, hover: false, palette: true },
        github: { enabled: true, hover: true, palette: true },
        youtube: { enabled: true, hover: true, palette: true },
        twitter: { enabled: true, inline: true, hover: true, palette: true },
      },
    });

    fireEvent.click(getSourceButton('Hacker News'));
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
      expect(last?.plugins.hacker_news).toEqual({
        enabled: true,
        inline: true,
        hover: true,
        palette: true,
      });
    });
  });

  it('disables master and feature switches while settings load', async () => {
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

    fireEvent.click(getSourceButton('Hacker News'));
    const inlineToggle = await screen.findByTitle(/^Inline on the row/i);
    expect(inlineToggle).toHaveProperty('disabled', true);

    for (const name of ['Hacker News', 'GitHub', 'YouTube', 'Twitter / X']) {
      expect(screen.getByRole('switch', { name })).toHaveProperty('disabled', true);
    }
    expect(screen.getByRole('switch', { name: 'In the command palette' })).toHaveProperty(
      'disabled',
      true,
    );
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
        hacker_news: { enabled: false, inline: true, hover: true, palette: true },
        github: { enabled: true, hover: true, palette: true },
        youtube: { enabled: true, hover: true, palette: true },
        twitter: { enabled: true, inline: true, hover: true, palette: true },
      },
    });

    // A disabled feature toggle's title is the neutral "— unavailable" form
    // (shared by the master-off and loading cases) — wait for the settled
    // (disabled) render specifically so this doesn't assert against the
    // transient loading render.
    fireEvent.click(getSourceButton('Hacker News'));
    const inlineToggle = await screen.findByTitle(/Inline on the row - unavailable/i);
    expect(inlineToggle).toHaveProperty('disabled', true);
    const hoverToggle = screen.getByTitle(/On hover \(preview card\) - unavailable/i);
    expect(hoverToggle).toHaveProperty('disabled', true);
    expect(screen.getByRole('switch', { name: 'In the command palette' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(inlineToggle.closest('[data-disabled]')?.getAttribute('data-disabled')).toBe('true');
  });

  it('re-enabling a master-disabled source re-enables its feature toggles', async () => {
    renderTab({
      ...defaultSettings(),
      plugins: {
        hacker_news: { enabled: false, inline: true, hover: true, palette: true },
        github: { enabled: true, hover: true, palette: true },
        youtube: { enabled: true, hover: true, palette: true },
        twitter: { enabled: true, inline: true, hover: true, palette: true },
      },
    });

    fireEvent.click(getSourceButton('Hacker News'));
    const masterToggle = await screen.findByTitle(/Hacker News is off/i);
    fireEvent.click(masterToggle);

    await waitFor(() => {
      const inlineToggle = screen.getByTitle(/Inline on the row/i);
      expect(inlineToggle).not.toHaveProperty('disabled', true);
    });
  });

  it('does not render the old footer note explaining plugins never change what gets saved', () => {
    renderTab();
    expect(screen.queryByText(/plugins add inline detail/i)).toBeNull();
  });

  describe('silo section (hover previews)', () => {
    it('defaults off and disables and greys link preview images', async () => {
      const { fetchMock } = renderTab();
      const toggle = await screen.findByTitle(/Hover previews is off/i);
      expect(toggle.getAttribute('aria-checked')).toBe('false');
      const images = screen.getByRole('switch', { name: 'Link preview images' });
      expect(images).toHaveProperty('disabled', true);
      expect(images.closest('[data-disabled]')?.getAttribute('data-disabled')).toBe('true');
      fireEvent.click(images);
      expect(fetchMock.mock.calls.some((call) => call[1]?.method === 'PATCH')).toBe(false);
      const rows = document.querySelectorAll('.silo-plugin-silo-row');
      expect(rows[0]?.textContent).toContain('Hover previews');
    });

    it('writes only hoverPreview when enabled and enables the image switch', async () => {
      const { fetchMock } = renderTab();
      fireEvent.click(await screen.findByTitle(/Hover previews is off/i));
      await screen.findByTitle(/Hover previews is on/i);
      const patch = fetchMock.mock.calls.find((call) => call[1]?.method === 'PATCH');
      expect(JSON.parse(patch?.[1]?.body as string)).toEqual({ hoverPreview: true });
      expect(screen.getByRole('switch', { name: 'Link preview images' })).toHaveProperty(
        'disabled',
        false,
      );
    });

    it('disables previews without changing the saved image preference', async () => {
      const { fetchMock, getStore } = renderTab({ ...defaultSettings(), hoverPreview: true });
      fireEvent.click(await screen.findByTitle(/Hover previews is on/i));
      await screen.findByTitle(/Hover previews is off/i);
      const patch = fetchMock.mock.calls.find((call) => call[1]?.method === 'PATCH');
      expect(JSON.parse(patch?.[1]?.body as string)).toEqual({ hoverPreview: false });
      expect(getStore().linkPreviewImages).toBe(true);
      expect(screen.getByRole('switch', { name: 'Link preview images' })).toHaveProperty(
        'disabled',
        true,
      );
    });

    it('disables both Silo switches while settings load', () => {
      vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise<Response>(() => {})));
      render(
        <QueryClientProvider client={new QueryClient()}>
          <PluginsTab />
        </QueryClientProvider>,
      );
      for (const name of ['Hover previews', 'Link preview images']) {
        expect(screen.getByRole('switch', { name })).toHaveProperty('disabled', true);
      }
      expect(
        screen.getByRole('switch', { name: 'Hover previews' }).getAttribute('aria-checked'),
      ).toBe('false');
    });

    it('disables both Silo switches during a pending write', async () => {
      const { fetchMock } = renderTab({ ...defaultSettings(), hoverPreview: true });
      const toggle = await screen.findByTitle(/Hover previews is on/i);
      fetchMock.mockImplementationOnce(() => new Promise<Response>(() => {}));
      fireEvent.click(toggle);
      await waitFor(() => {
        for (const name of ['Hover previews', 'Link preview images']) {
          expect(screen.getByRole('switch', { name })).toHaveProperty('disabled', true);
        }
      });
    });
  });

  describe('silo section (link preview images)', () => {
    it('renders the "Link preview images" toggle row', async () => {
      renderTab({ ...defaultSettings(), hoverPreview: true });
      await waitFor(() => expect(screen.getByTitle(/Link preview images is on/i)).toBeDefined());
      expect(screen.getByText('Link preview images')).toBeDefined();
    });

    it('reflects settings.linkPreviewImages: false as an off toggle', async () => {
      renderTab({ ...defaultSettings(), hoverPreview: true, linkPreviewImages: false });
      await waitFor(() => expect(screen.getByTitle(/Link preview images is off/i)).toBeDefined());
    });

    it('toggling it off calls updateSettings.mutate({ linkPreviewImages: false })', async () => {
      const { fetchMock } = renderTab({ ...defaultSettings(), hoverPreview: true });

      const toggle = await screen.findByTitle(/Link preview images is on/i);
      fireEvent.click(toggle);

      await waitFor(() => {
        const patchCall = fetchMock.mock.calls.find(
          (call) => (call[1] as RequestInit | undefined)?.method === 'PATCH',
        );
        expect(patchCall).toBeDefined();
        const body = JSON.parse((patchCall?.[1] as RequestInit).body as string);
        expect(body).toEqual({ linkPreviewImages: false });
      });
    });

    it('toggling it back on calls updateSettings.mutate({ linkPreviewImages: true })', async () => {
      const { fetchMock } = renderTab({
        ...defaultSettings(),
        hoverPreview: true,
        linkPreviewImages: false,
      });

      const toggle = await screen.findByTitle(/Link preview images is off/i);
      fireEvent.click(toggle);

      await waitFor(() => {
        const patchCall = fetchMock.mock.calls.find(
          (call) => (call[1] as RequestInit | undefined)?.method === 'PATCH',
        );
        expect(patchCall).toBeDefined();
        const body = JSON.parse((patchCall?.[1] as RequestInit).body as string);
        expect(body).toEqual({ linkPreviewImages: true });
      });
    });

    it('the toggle is disabled while settings are still loading', async () => {
      const neverResolves = new Promise<Response>(() => {});
      const fetchMock = vi.fn().mockReturnValue(neverResolves);
      vi.stubGlobal('fetch', fetchMock);
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <QueryClientProvider client={queryClient}>
          <PluginsTab />
        </QueryClientProvider>,
      );

      const toggle = await screen.findByTitle(/Link preview images/i);
      expect(toggle).toHaveProperty('disabled', true);
    });
  });
});

describe('PluginsTab AI titles toggle', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const feature = {
    id: 'x-post-title',
    label: 'AI titles',
    description: 'Short titles written by your AI model',
    plugin: 'twitter',
  };

  function aiSettings(on = false) {
    return {
      ...defaultSettings(),
      ai: { enabled: true, provider: 'anthropic', model: null, features: { 'x-post-title': on } },
    };
  }

  function renderWithAi(ready: boolean, on = false) {
    let store: ReturnType<typeof aiSettings> = aiSettings(on);
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/settings')) {
        if (init?.method === 'PATCH') {
          store = { ...store, ...JSON.parse((init.body as string) ?? '{}') };
        }
        return Promise.resolve(jsonResponse(store));
      }
      if (url.includes('/api/ai')) {
        return Promise.resolve(
          jsonResponse({
            status: { enabled: ready, secretKey: 'ok', provider: null, model: null, ready },
            providers: [],
            catalog: [],
            features: [feature],
          }),
        );
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <PluginsTab />
      </QueryClientProvider>,
    );
    return { fetchMock, getStore: () => store };
  }

  it('shows the toggle disabled with a hint until AI is ready', async () => {
    renderWithAi(false);
    fireEvent.click(await screen.findByRole('button', { name: 'Twitter / X' }));
    const toggle = await screen.findByRole('switch', { name: 'AI titles' });
    await screen.findByText('Turn on AI in the AI tab');
    expect((toggle as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText('Short titles written by your AI model')).toBeNull();
  });

  it('does not show the toggle under another source', async () => {
    renderWithAi(true);
    fireEvent.click(await screen.findByRole('button', { name: 'GitHub' }));
    await screen.findByRole('switch', { name: 'On hover (preview card)' });
    expect(screen.queryByRole('switch', { name: 'AI titles' })).toBeNull();
  });

  it('enables the toggle when AI is ready and writes ai.features through settings', async () => {
    const { getStore } = renderWithAi(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Twitter / X' }));
    await screen.findByText('Short titles written by your AI model');
    const toggle = (await screen.findByRole('switch', { name: 'AI titles' })) as HTMLButtonElement;
    await waitFor(() => expect(toggle.disabled).toBe(false));
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(getStore().ai).toEqual({
        enabled: true,
        provider: 'anthropic',
        model: null,
        features: { 'x-post-title': true },
      }),
    );
  });
});
