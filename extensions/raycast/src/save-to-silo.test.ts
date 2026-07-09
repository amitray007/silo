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

  it('closes Raycast after a successful save', async () => {
    runAppleScript.mockImplementation(async (script: string) => {
      if (script.includes('System Events')) return 'Google Chrome';
      if (script.includes('Google Chrome')) return 'https://example.com␟Example';
      throw new Error('unexpected script');
    });
    captureLink.mockResolvedValue({
      link: { id: '1', url: 'https://example.com', captureStatus: 'full' },
      deduped: false,
    });

    const { default: Command } = await import('./save-to-silo.js');
    await Command();

    expect(showHUD).toHaveBeenCalledWith(expect.stringContaining('Saved to silo'));
    expect(closeMainWindow).toHaveBeenCalled();
  });

  it('does not close Raycast when the save fails', async () => {
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
    expect(closeMainWindow).not.toHaveBeenCalled();
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

  it('shows an error HUD when no URL can be resolved (no browser, no clipboard URL)', async () => {
    runAppleScript.mockImplementation(async (script: string) => {
      if (script.includes('System Events')) return 'Finder';
      throw new Error('should not query a non-frontmost browser');
    });
    readText.mockResolvedValue('not a url');

    const { default: Command } = await import('./save-to-silo.js');
    await Command();

    expect(captureLink).not.toHaveBeenCalled();
    expect(showHUD).toHaveBeenCalledWith(expect.stringContaining('✗'));
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
