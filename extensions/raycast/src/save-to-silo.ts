import { showHUD } from '@raycast/api';
import { CaptureError, captureLink } from './lib/capture-client.js';
import { resolveUrl } from './lib/resolve-url.js';

/**
 * The PRIMARY command (brief: "instant capture — one keystroke, saved,
 * done"). No form, no confirmation step: resolve a URL (frontmost browser
 * tab first, else clipboard), POST, `showHUD`. Enrichment happens in silo's
 * backend and this command does NOT wait for or gate on it — the HUD fires
 * the instant the capture request itself settles.
 */
export default async function Command(): Promise<void> {
  const resolved = await resolveUrl();
  if (!resolved) {
    await showHUD('✗ No URL found (no supported browser tab or clipboard URL)');
    return;
  }

  try {
    const { deduped } = await captureLink({ url: resolved.url });
    await showHUD(deduped ? '✓ Already in silo (updated)' : '✓ Saved to silo');
  } catch (error) {
    const message = error instanceof CaptureError ? error.message : 'Could not save to silo';
    await showHUD(`✗ ${message}`);
  }
}
