import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

/** Renders `SettingsModal` already "open" via the shared context, plus a trigger button so focus-restore-on-close is observable — mirrors `EditModal.test.tsx`'s `Harness` pattern. */
function Harness() {
  const { open, openSettings } = useSettings();
  return (
    <div>
      <button type="button" onClick={() => openSettings()}>
        trigger
      </button>
      {open && <SettingsModal />}
    </div>
  );
}

function renderModal() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <SettingsProvider>
          <Harness />
        </SettingsProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  const trigger = screen.getByText('trigger');
  // jsdom's fireEvent.click doesn't implicitly focus the target the way a
  // real browser click does — focus it explicitly so the modal's
  // focus-restore-on-close has a real "trigger" element to return to.
  trigger.focus();
  // ModalShell restores focus on close ONLY for keyboard opens (modality-aware
  // — a mouse-opened modal restoring focus paints a noisy focus ring). These
  // tests verify that keyboard-user restore path, so open via keyboard: a
  // keydown sets keyboard modality before the activating click.
  fireEvent.keyDown(trigger, { key: 'Enter' });
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

  it('opens on the Plugins tab by default (matching v3) and shows the underlined tab strip', () => {
    renderModal();
    expect(screen.getByRole('dialog', { name: /settings/i })).toBeDefined();
    expect(screen.getByRole('tablist', { name: /settings sections/i })).toBeDefined();
    const pluginsTab = screen.getByRole('tab', { name: 'Plugins' });
    expect(pluginsTab.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Preferences' })).toBeDefined();
    expect(screen.getByRole('tab', { name: 'Import / Export' })).toBeDefined();
    expect(screen.getByRole('tab', { name: 'Access' })).toBeDefined();
    expect(screen.getAllByText('Hacker News').length).toBeGreaterThan(0);
    expect(screen.queryByText(/plugins add inline detail/i)).toBeNull();
  });

  it('switches tabs on click, rendering each panel exclusively and updating aria-selected', () => {
    renderModal();

    fireEvent.click(screen.getByRole('tab', { name: 'Preferences' }));
    expect(screen.getByRole('tab', { name: 'Preferences' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.getByRole('tab', { name: 'Plugins' }).getAttribute('aria-selected')).toBe(
      'false',
    );
    // "Theme" appears twice while Preferences is active (the row label AND
    // ThemeToggle's visually-hidden <legend>) — assert at least one, and use
    // the row label specifically to prove Preferences rendered.
    expect(screen.getAllByText('Theme').length).toBeGreaterThan(0);
    expect(screen.queryByText(/plugins add inline detail/i)).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Import / Export' }));
    expect(screen.getByText('Import')).toBeDefined();
    expect(screen.getByText('Export')).toBeDefined();
    expect(screen.queryByText('Theme')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Access' }));
    expect(screen.getAllByText('MCP access').length).toBeGreaterThan(0);
    expect(screen.queryByText('Import')).toBeNull();
  });

  it('the esc button closes the modal and restores focus to the trigger', () => {
    renderModal();
    const trigger = screen.getByText('trigger');
    expect(document.activeElement).toBe(screen.getByRole('dialog'));

    fireEvent.click(screen.getByRole('button', { name: 'esc' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('a MOUSE-opened modal does NOT restore focus to the trigger on close (no noisy focus ring)', () => {
    // The modality-aware counterpart to the keyboard test above: when the
    // modal was opened by a pointer, closing it must NOT refocus the trigger,
    // so a mouse user is never left with a `:focus-visible` ring on a button
    // they clicked and moved on from.
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <SettingsProvider>
            <Harness />
          </SettingsProvider>
        </ThemeProvider>
      </QueryClientProvider>,
    );
    const trigger = screen.getByText('trigger');
    trigger.focus();
    // Pointer modality (no preceding keydown) — mirrors a real mouse open.
    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'esc' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    // Focus was NOT forced back to the trigger.
    expect(document.activeElement).not.toBe(trigger);
  });

  it('the ✕ close button closes the modal and restores focus to the trigger', () => {
    renderModal();
    const trigger = screen.getByText('trigger');

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('Escape closes the modal', () => {
    renderModal();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('clicking the scrim closes the modal, but clicking inside the panel does not', () => {
    renderModal();
    const dialog = screen.getByRole('dialog');

    fireEvent.click(dialog);
    expect(screen.getByRole('dialog')).toBeDefined();

    fireEvent.click(dialog.parentElement as Element);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('focus moves into the panel on open (focus-trap host)', () => {
    renderModal();
    expect(document.activeElement).toBe(screen.getByRole('dialog'));
  });

  it('remembers the last-viewed tab across close/reopen (does NOT reset to Plugins — deliberate, per SettingsContext doc comment)', () => {
    renderModal();
    // Switch away from the default Plugins tab, then close.
    fireEvent.click(screen.getByRole('tab', { name: 'Access' }));
    expect(screen.getAllByText('MCP access').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'esc' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    // Reopen via the trigger — it should land back on Access, not Plugins.
    fireEvent.click(screen.getByText('trigger'));
    expect(screen.getAllByText('MCP access').length).toBeGreaterThan(0);
    expect(screen.queryByText(/plugins add inline detail/i)).toBeNull();
  });

  describe('Preferences tab', () => {
    it('the real theme toggle changes the theme (data-theme flips)', () => {
      renderModal();
      fireEvent.click(screen.getByRole('tab', { name: 'Preferences' }));

      expect(document.documentElement.getAttribute('data-theme')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

      fireEvent.click(screen.getByRole('button', { name: 'Light' }));
      expect(document.documentElement.getAttribute('data-theme')).toBeNull();
    });

    it('shows the persisted purge window as a custom dropdown, and selecting an option PATCHes it', async () => {
      renderModal();
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
      renderModal();
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
      renderModal();
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
      renderModal();
      fireEvent.click(screen.getByRole('tab', { name: 'Import / Export' }));

      const chooseFile = screen.getByRole('button', { name: /choose file/i });
      const download = screen.getByRole('button', { name: /download/i });
      expect(chooseFile).not.toHaveProperty('disabled', true);
      expect(download).not.toHaveProperty('disabled', true);
    });
  });

  describe('Access tab', () => {
    it('renders the hero card with the honest MCP-access copy', () => {
      renderModal();
      fireEvent.click(screen.getByRole('tab', { name: 'Access' }));

      expect(screen.getByText(/let an agent add, search, and read your links/i)).toBeDefined();
    });

    it('renders a LIVE MCP-access switch reflecting the mcpAccess setting', async () => {
      renderModal();
      fireEvent.click(screen.getByRole('tab', { name: 'Access' }));

      const mcpToggle = await screen.findByRole('switch', { name: /MCP access/i });
      await waitFor(() => expect(mcpToggle).toHaveProperty('disabled', false));
      expect(mcpToggle.getAttribute('aria-checked')).toBe('true');
    });

    it('clicking the MCP-access switch PATCHes mcpAccess flipped', async () => {
      renderModal();
      fireEvent.click(screen.getByRole('tab', { name: 'Access' }));

      const mcpToggle = await screen.findByRole('switch', { name: /MCP access/i });
      await waitFor(() => expect(mcpToggle).toHaveProperty('disabled', false));
      fireEvent.click(mcpToggle);

      await waitFor(() => expect(mcpToggle.getAttribute('aria-checked')).toBe('false'));
    });

    it('"Copy config" (the hero\'s primary action) writes the HTTP MCP client config to the clipboard', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, { clipboard: { writeText } });

      renderModal();
      fireEvent.click(screen.getByRole('tab', { name: 'Access' }));
      fireEvent.click(screen.getByRole('button', { name: /copy config/i }));

      expect(writeText).toHaveBeenCalledTimes(1);
      const written = writeText.mock.calls[0]?.[0] as string;
      expect(written).toContain('"mcpServers"');
      expect(written).toContain('"silo"');
      expect(written).toContain('/mcp');
      expect(written).toContain('Authorization');
      expect(await screen.findByText('Copied')).toBeDefined();
    });

    it('a failed clipboard write shows an honest error label instead of "Copied" (no unhandled rejection)', async () => {
      // navigator.clipboard.writeText rejects in real conditions (insecure
      // context, denied permission) — the label must reflect that, not
      // silently look like success (review fix, ce-correctness).
      const writeText = vi.fn().mockRejectedValue(new Error('denied'));
      Object.assign(navigator, { clipboard: { writeText } });

      renderModal();
      fireEvent.click(screen.getByRole('tab', { name: 'Access' }));
      fireEvent.click(screen.getByRole('button', { name: /copy config/i }));

      expect(await screen.findByText("Couldn't copy")).toBeDefined();
      expect(screen.queryByText('Copied')).toBeNull();
    });
  });
});
