import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
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
  fireEvent.click(trigger);
  return utils;
}

describe('SettingsModal', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ live: 4, trash: 1, purgeWindowDays: 30 })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens on the Plugins tab by default (matching v3) and shows the segmented tab strip', () => {
    renderModal();
    expect(screen.getByRole('dialog', { name: /settings/i })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Plugins' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Preferences' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Import/Export' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Access' })).toBeDefined();
    expect(screen.getByText(/plugins add inline detail/i)).toBeDefined();
  });

  it('switches tabs on click, rendering each panel exclusively', () => {
    renderModal();

    fireEvent.click(screen.getByRole('button', { name: 'Preferences' }));
    // "Theme" appears twice while Preferences is active (the row label AND
    // ThemeToggle's visually-hidden <legend>) — assert at least one, and use
    // the row label specifically to prove Preferences rendered.
    expect(screen.getAllByText('Theme').length).toBeGreaterThan(0);
    expect(screen.queryByText(/plugins add inline detail/i)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Import/Export' }));
    expect(screen.getByText('Import')).toBeDefined();
    expect(screen.getByText('Export')).toBeDefined();
    expect(screen.queryByText('Theme')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Access' }));
    expect(screen.getByText('MCP access')).toBeDefined();
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
    fireEvent.click(screen.getByRole('button', { name: 'Access' }));
    expect(screen.getByText('MCP access')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'esc' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    // Reopen via the trigger — it should land back on Access, not Plugins.
    fireEvent.click(screen.getByText('trigger'));
    expect(screen.getByText('MCP access')).toBeDefined();
    expect(screen.queryByText(/plugins add inline detail/i)).toBeNull();
  });

  describe('Preferences tab', () => {
    it('the real theme toggle changes the theme (data-theme flips)', () => {
      renderModal();
      fireEvent.click(screen.getByRole('button', { name: 'Preferences' }));

      expect(document.documentElement.getAttribute('data-theme')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'dark' }));
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

      fireEvent.click(screen.getByRole('button', { name: 'light' }));
      expect(document.documentElement.getAttribute('data-theme')).toBeNull();
    });

    it('shows the real purge window from /api/counts, disabled (non-functional)', async () => {
      renderModal();
      fireEvent.click(screen.getByRole('button', { name: 'Preferences' }));

      const purgeButton = await screen.findByRole('button', { name: /30 days/i });
      expect(purgeButton).toHaveProperty('disabled', true);
    });
  });

  describe('Plugins tab (parked)', () => {
    it('renders all four plugin rows with no functional toggle', () => {
      renderModal();
      expect(screen.getByText('Hacker News')).toBeDefined();
      expect(screen.getByText('Twitter / X')).toBeDefined();
      expect(screen.getByText('GitHub')).toBeDefined();
      expect(screen.getByText('YouTube')).toBeDefined();
      // No dot/checkbox-style toggle controls — just calm "soon" chips (text, not <button role>s with on/off state).
      expect(screen.queryAllByRole('button', { name: /set up/i })).toHaveLength(0);
    });
  });

  describe('Import/Export tab (stubbed)', () => {
    it('renders Import/Export rows with disabled buttons', () => {
      renderModal();
      fireEvent.click(screen.getByRole('button', { name: 'Import/Export' }));

      const chooseFile = screen.getByRole('button', { name: /choose file/i });
      const download = screen.getByRole('button', { name: /download/i });
      expect(chooseFile).toHaveProperty('disabled', true);
      expect(download).toHaveProperty('disabled', true);
    });
  });

  describe('Access tab', () => {
    it('renders the MCP toggle and Rotate as disabled/non-functional', () => {
      renderModal();
      fireEvent.click(screen.getByRole('button', { name: 'Access' }));

      const mcpToggle = screen.getByTitle(/always on/i);
      expect(mcpToggle).toHaveProperty('disabled', true);
      const rotate = screen.getByRole('button', { name: /rotate/i });
      expect(rotate).toHaveProperty('disabled', true);
    });

    it('"Copy config" writes the static MCP client config to the clipboard', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, { clipboard: { writeText } });

      renderModal();
      fireEvent.click(screen.getByRole('button', { name: 'Access' }));
      fireEvent.click(screen.getByRole('button', { name: /copy config/i }));

      expect(writeText).toHaveBeenCalledTimes(1);
      const written = writeText.mock.calls[0]?.[0] as string;
      expect(written).toContain('"mcpServers"');
      expect(written).toContain('"silo"');
      expect(await screen.findByText('Copied')).toBeDefined();
    });

    it('a failed clipboard write shows an honest error label instead of "Copied" (no unhandled rejection)', async () => {
      // navigator.clipboard.writeText rejects in real conditions (insecure
      // context, denied permission) — the label must reflect that, not
      // silently look like success (review fix, ce-correctness).
      const writeText = vi.fn().mockRejectedValue(new Error('denied'));
      Object.assign(navigator, { clipboard: { writeText } });

      renderModal();
      fireEvent.click(screen.getByRole('button', { name: 'Access' }));
      fireEvent.click(screen.getByRole('button', { name: /copy config/i }));

      expect(await screen.findByText("Couldn't copy")).toBeDefined();
      expect(screen.queryByText('Copied')).toBeNull();
    });
  });
});
