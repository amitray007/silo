import { beforeEach, describe, expect, it, vi } from 'vitest';

const showHUD = vi.fn();
const runAppleScript = vi.fn();
const readText = vi.fn();
const getPreferenceValues = vi.fn();
const captureLink = vi.fn();
const closeMainWindow = vi.fn(async (..._args: unknown[]) => {});
const popToRoot = vi.fn(async (..._args: unknown[]) => {});

vi.mock('@raycast/api', () => ({
  showHUD: (...args: unknown[]) => showHUD(...args),
  Clipboard: { readText: (...args: unknown[]) => readText(...args) },
  getPreferenceValues: (...args: unknown[]) => getPreferenceValues(...args),
  closeMainWindow: (...args: unknown[]) => closeMainWindow(...args),
  popToRoot: (...args: unknown[]) => popToRoot(...args),
  PopToRootType: { Immediate: 'immediate' },
}));

vi.mock('@raycast/utils', () => ({
  runAppleScript: (...args: unknown[]) => runAppleScript(...args),
}));

vi.mock('./lib/capture-client.js', async () => {
  const actual =
    await vi.importActual<typeof import('./lib/capture-client.js')>('./lib/capture-client.js');
  return { ...actual, captureLink: (...args: unknown[]) => captureLink(...args) };
});

describe('save-to-silo (instant capture)', () => {
  beforeEach(() => {
    showHUD.mockReset();
    runAppleScript.mockReset();
    readText.mockReset();
    getPreferenceValues.mockReturnValue({ baseUrl: 'http://localhost:8787' });
    captureLink.mockReset();
    closeMainWindow.mockReset();
    popToRoot.mockReset();
  });

  it("resolves the frontmost browser tab, captures it, and shows a success HUD — the capture call resolves immediately regardless of the link's enrichment status", async () => {
    runAppleScript.mockImplementation(async (script: string) => {
      if (script.includes('System Events')) return 'Google Chrome';
      if (script.includes('Google Chrome')) return 'https://example.com␟Example';
      throw new Error('unexpected script');
    });
    // The API can return `captureStatus: 'enriching'` — the command must
    // not gate the HUD on it settling to `full`.
    captureLink.mockResolvedValue({
      link: { id: '1', url: 'https://example.com', captureStatus: 'enriching' },
      deduped: false,
    });

    const { default: Command } = await import('./save-to-silo.js');
    await Command();

    expect(captureLink).toHaveBeenCalledWith({ url: 'https://example.com' });
    expect(showHUD).toHaveBeenCalledWith('✓ Saved to silo');
  });

  it('closes Raycast BEFORE the save completes (close-first, save-in-background)', async () => {
    runAppleScript.mockImplementation(async (script: string) => {
      if (script.includes('System Events')) return 'Google Chrome';
      if (script.includes('Google Chrome')) return 'https://example.com␟Example';
      throw new Error('unexpected script');
    });
    // Order-tracking: record when close vs capture were invoked.
    const calls: string[] = [];
    closeMainWindow.mockImplementation(async () => {
      calls.push('close');
    });
    captureLink.mockImplementation(async () => {
      calls.push('capture');
      return {
        link: { id: '1', url: 'https://example.com', captureStatus: 'full' },
        deduped: false,
      };
    });

    const { default: Command } = await import('./save-to-silo.js');
    await Command();

    // close must be called, and BEFORE the capture request fires.
    expect(calls[0]).toBe('close');
    expect(calls).toContain('capture');
    expect(showHUD).toHaveBeenCalledWith(expect.stringContaining('Saved to silo'));
  });

  it('still closes Raycast even when the save fails, then shows the error HUD', async () => {
    runAppleScript.mockImplementation(async (script: string) => {
      if (script.includes('System Events')) return 'Finder';
      throw new Error('should not query a non-frontmost browser');
    });
    readText.mockResolvedValue('https://example.com');
    const { CaptureError } = await import('./lib/capture-client.js');
    captureLink.mockRejectedValue(new CaptureError('unreachable', 'Could not reach silo'));

    const { default: Command } = await import('./save-to-silo.js');
    await Command();

    // close-first means a failed save no longer keeps the window open.
    expect(closeMainWindow).toHaveBeenCalled();
    expect(showHUD).toHaveBeenCalledWith('✗ Could not reach silo');
  });

  it('shows a dedup HUD when the API folds into an existing link', async () => {
    runAppleScript.mockImplementation(async (script: string) => {
      if (script.includes('System Events')) return 'Finder';
      throw new Error('should not query a non-frontmost browser');
    });
    readText.mockResolvedValue('https://example.com');
    captureLink.mockResolvedValue({
      link: { id: '1', url: 'https://example.com', captureStatus: 'full' },
      deduped: true,
    });

    const { default: Command } = await import('./save-to-silo.js');
    await Command();

    expect(showHUD).toHaveBeenCalledWith('✓ Already in silo (updated)');
  });

  it('closes silently with NO HUD when no valid URL resolves (nothing to save)', async () => {
    runAppleScript.mockImplementation(async (script: string) => {
      if (script.includes('System Events')) return 'Finder';
      throw new Error('should not query a non-frontmost browser');
    });
    readText.mockResolvedValue('not a url'); // invalid → resolveUrl returns undefined

    const { default: Command } = await import('./save-to-silo.js');
    await Command();

    // No save attempted, Raycast closes, and NO error HUD fires (an
    // absent/invalid URL is a silent no-op per design).
    expect(captureLink).not.toHaveBeenCalled();
    expect(closeMainWindow).toHaveBeenCalled();
    expect(showHUD).not.toHaveBeenCalled();
  });

  it('shows an error HUD with the actionable message when the API is unreachable', async () => {
    runAppleScript.mockImplementation(async (script: string) => {
      if (script.includes('System Events')) return 'Finder';
      throw new Error('should not query a non-frontmost browser');
    });
    readText.mockResolvedValue('https://example.com');
    const { CaptureError } = await import('./lib/capture-client.js');
    captureLink.mockRejectedValue(new CaptureError('unreachable', 'Could not reach silo'));

    const { default: Command } = await import('./save-to-silo.js');
    await Command();

    expect(showHUD).toHaveBeenCalledWith('✗ Could not reach silo');
  });
});
