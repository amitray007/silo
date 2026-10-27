import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../theme/ThemeProvider';
import { SettingsProvider, useSettings } from './SettingsContext';
import { SettingsModal } from './SettingsModal';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** The default `/api/settings` GET response — every field at its server-side default (mirrors `SETTINGS_DEFAULTS`, `packages/core/src/settings/schema.ts`; `plugins` nested per-feature shape as of plan 026). */
const DEFAULT_SETTINGS = {
  theme: 'system',
  trashPurgeDays: 30,
  mcpAccess: true,
  linkPreviewImages: true,
  hoverPreview: false,
  plugins: {
    hacker_news: { enabled: true, inline: true, hover: true },
    github: { enabled: true, hover: true },
    youtube: { enabled: true, hover: true },
    twitter: { enabled: true, inline: true, hover: true },
  },
};

/**
 * Route-aware, STATEFUL fetch stub — `PreferencesTab`/`PluginsTab` now hit
 * `GET /api/settings` (plan 016) alongside the pre-existing `GET
 * /api/counts` `PreferencesTab` also reads; a single fixed mock response
 * (the old approach) would hand `/api/settings` the counts shape and vice
 * versa. Stateful because `useUpdateSettings`'s `onSettled` re-invalidates
 * `settings` after every PATCH, firing a follow-up GET — a stateLESS mock
 * would hand that GET the ORIGINAL defaults back, silently reverting
 * whatever the PATCH just "persisted" and making every toggle/cycle test
 * flake against a stale read. `store` is reset per-test via `beforeEach`
 * (mirrors the real API's per-request-fresh-DB isolation closely enough for
 * these UI tests, which don't hit the real API).
 */
function mockFetchRouter() {
  let store = { ...DEFAULT_SETTINGS };
  return vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/api/settings')) {
      if (init?.method === 'PATCH') {
        const patch = JSON.parse((init.body as string) ?? '{}');
        store = { ...store, ...patch };
        return Promise.resolve(jsonResponse(store));
      }
      return Promise.resolve(jsonResponse(store));
    }
    return Promise.resolve(jsonResponse({ live: 4, trash: 1, purgeWindowDays: 30 }));
  });
}

/** Settings navigation runs through the real router and shared context. */
function Harness() {
  const { open, openSettings } = useSettings();
  const location = useLocation();
  return (
    <div>
      <output data-testid="settings-url">{location.pathname}</output>
      <button type="button" onClick={() => openSettings()}>
        trigger
      </button>
      {open && <SettingsModal />}
    </div>
  );
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <MemoryRouter>
          <SettingsProvider>
            <Harness />
          </SettingsProvider>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  const trigger = screen.getByText('trigger');
  fireEvent.click(trigger);
  return utils;
}

describe('SettingsModal', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetchRouter());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens the Plugins modal without changing the URL', () => {
    renderPage();
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeDefined();
    expect(screen.getByTestId('settings-url').textContent).toBe('/');
    expect(
      screen.getByRole('tablist', { name: 'Settings sections' }).getAttribute('aria-orientation'),
    ).toBeNull();
    expect(screen.getByRole('tab', { name: 'Plugins' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getAllByText('Hacker News').length).toBeGreaterThan(0);
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeDefined();
  });

  it('switches modal tabs and keeps the existing settings controls', () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'Preferences' }));
    expect(screen.getByTestId('settings-url').textContent).toBe('/');
    expect(screen.getByRole('tab', { name: 'Preferences' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.getByRole('switch', { name: 'Compact links' })).toBeDefined();
    fireEvent.click(screen.getByRole('tab', { name: 'Import & export' }));
    expect(screen.getByText('Import')).toBeDefined();
    expect(screen.getByText('Export')).toBeDefined();
    fireEvent.click(screen.getByRole('tab', { name: 'Access' }));
    expect(screen.getAllByText('MCP access').length).toBeGreaterThan(0);
  });

  it('returns from Settings with its close control', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull();
    expect(screen.getByTestId('settings-url').textContent).toBe('/');
  });

  it('navigates settings tabs with the arrow keys', () => {
    renderPage();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Plugins' }), { key: 'ArrowDown' });
    expect(screen.getByRole('tab', { name: 'Preferences' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Preferences' }));
    expect(screen.getByTestId('settings-url').textContent).toBe('/');
  });

  it('Escape returns to links when no dialog is open', () => {
    renderPage();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull();
  });

  it('focuses the modal on entry', () => {
    renderPage();
    expect(document.activeElement).toBe(screen.getByRole('dialog', { name: 'Settings' }));
  });

  it('remembers the last tab when reopening Settings', () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'Access' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByText('trigger'));
    expect(screen.getByTestId('settings-url').textContent).toBe('/');
    expect(screen.getAllByText('MCP access').length).toBeGreaterThan(0);
  });

  describe('Preferences tab', () => {
    it('the real theme toggle changes the theme (data-theme flips)', () => {
      renderPage();
      fireEvent.click(screen.getByRole('tab', { name: 'Preferences' }));

      expect(document.documentElement.getAttribute('data-theme')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

      fireEvent.click(screen.getByRole('button', { name: 'Light' }));
      expect(document.documentElement.getAttribute('data-theme')).toBeNull();
    });

    it('shows the persisted purge window as a custom dropdown, and selecting an option PATCHes it', async () => {
      renderPage();
      fireEvent.click(screen.getByRole('tab', { name: 'Preferences' }));

      const purgeButton = await screen.findByRole('button', {
        name: /trash auto-empty window/i,
      });
      expect(purgeButton.textContent).toContain('30 days');
      expect(purgeButton.getAttribute('aria-expanded')).toBe('false');

      fireEvent.click(purgeButton);
      expect(screen.getByRole('listbox')).toBeDefined();
      expect(screen.getByRole('option', { name: '7 days' })).toBeDefined();
      expect(screen.getByRole('option', { name: /30 days/ }).getAttribute('aria-selected')).toBe(
        'true',
      );
      fireEvent.click(screen.getByRole('option', { name: '90 days' }));

      const updatedButton = await screen.findByRole('button', {
        name: /trash auto-empty window/i,
      });
      expect(updatedButton.textContent).toContain('90 days');
      expect(screen.queryByRole('listbox')).toBeNull();
    });
  });

  describe('Plugins tab (plan 026 — logo grid + expand panel)', () => {
    it('renders a 4-up grid with all four sources as real toggles (no "Soon" card)', () => {
      renderPage();
      fireEvent.click(screen.getByRole('tab', { name: 'Plugins' }));

      // HN's panel is expanded by default, so its name appears twice (card +
      // panel header); each brand SVG's <title> also matches its own name by
      // text content — getAllByText (existence, not uniqueness) sidesteps both.
      expect(screen.getAllByText('Hacker News').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Twitter / X').length).toBeGreaterThan(0);
      expect(screen.getAllByText('GitHub').length).toBeGreaterThan(0);
      expect(screen.getAllByText('YouTube').length).toBeGreaterThan(0);
      expect(screen.queryByText('Soon')).toBeNull();
    });

    it('clicking the master toggle in the expand panel flips it off and PATCHes the full nested plugins record', async () => {
      renderPage();
      fireEvent.click(screen.getByRole('tab', { name: 'Plugins' }));

      // HN's card is selected by default — its expand panel is already open.
      const hnToggle = await screen.findByTitle(/Hacker News is on/i);
      await waitFor(() => expect(hnToggle).not.toHaveProperty('disabled', true));

      fireEvent.click(hnToggle);

      await waitFor(() => {
        expect(screen.getByTitle(/Hacker News is off/i)).toBeDefined();
      });
      // The toggle is now a slider switch (role="switch"/aria-checked), not the
      // old aria-pressed button.
      expect(screen.getByTitle(/Hacker News is off/i).getAttribute('aria-checked')).toBe('false');
    });
  });

  describe('Import/Export tab (plan 028 — both Import and Export live)', () => {
    it('renders Import (Choose file…) and Export (Download) both live', () => {
      renderPage();
      fireEvent.click(screen.getByRole('tab', { name: 'Import & export' }));

      const chooseFile = screen.getByRole('button', { name: /choose file/i });
      const download = screen.getByRole('button', { name: /download/i });
      expect(chooseFile).not.toHaveProperty('disabled', true);
      expect(download).not.toHaveProperty('disabled', true);
    });
  });

  describe('Access tab', () => {
    it('renders the hero card with the honest MCP-access copy', () => {
      renderPage();
      fireEvent.click(screen.getByRole('tab', { name: 'Access' }));

      expect(screen.getByText(/let an agent add, search, and read your links/i)).toBeDefined();
    });

    it('renders a LIVE MCP-access switch reflecting the mcpAccess setting', async () => {
      renderPage();
      fireEvent.click(screen.getByRole('tab', { name: 'Access' }));

      const mcpToggle = await screen.findByRole('switch', { name: /MCP access/i });
      await waitFor(() => expect(mcpToggle).toHaveProperty('disabled', false));
      expect(mcpToggle.getAttribute('aria-checked')).toBe('true');
    });

    it('clicking the MCP-access switch PATCHes mcpAccess flipped', async () => {
      renderPage();
      fireEvent.click(screen.getByRole('tab', { name: 'Access' }));

      const mcpToggle = await screen.findByRole('switch', { name: /MCP access/i });
      await waitFor(() => expect(mcpToggle).toHaveProperty('disabled', false));
      fireEvent.click(mcpToggle);

      await waitFor(() => expect(mcpToggle.getAttribute('aria-checked')).toBe('false'));
    });

    /**
     * "Set up" (formerly "Copy config") opens `McpSetupDialog` — a SECOND
     * `ModalShell` stacked on top of this Settings modal — rather than
     * writing straight to the clipboard. Field-by-field clipboard coverage
     * (URL / transport / auth header / CLI / JSON config, each its own
     * `useCopyFlash()`) lives in `SettingsTabs/McpSetupDialog.test.tsx`; this
     * just proves the Settings-modal-level wiring: the button opens the
     * dialog, and it stacks above (rather than replacing) Settings.
     */
    it('"Set up" (the hero\'s primary action) opens the stacked MCP setup dialog', async () => {
      renderPage();
      fireEvent.click(screen.getByRole('tab', { name: 'Access' }));
      fireEvent.click(screen.getByRole('button', { name: 'Set up' }));

      expect(await screen.findByRole('dialog', { name: 'Connect over MCP' })).toBeDefined();
      // Settings itself is still mounted underneath — the dialog stacks on
      // top rather than replacing it.
      expect(screen.getByRole('dialog', { name: 'Settings' })).toBeDefined();
    });

    it('Escape closes only the MCP setup dialog, not the Settings modal underneath', async () => {
      renderPage();
      fireEvent.click(screen.getByRole('tab', { name: 'Access' }));
      fireEvent.click(screen.getByRole('button', { name: 'Set up' }));
      await screen.findByRole('dialog', { name: 'Connect over MCP' });

      fireEvent.keyDown(document, { key: 'Escape' });

      await waitFor(() =>
        expect(screen.queryByRole('dialog', { name: 'Connect over MCP' })).toBeNull(),
      );
      expect(screen.getByRole('dialog', { name: 'Settings' })).toBeDefined();
    });
  });
});
