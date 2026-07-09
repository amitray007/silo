import { closeMainWindow, PopToRootType, showHUD } from '@raycast/api';
import { CaptureError, captureLink } from './lib/capture-client.js';
import { resolveUrl } from './lib/resolve-url.js';

/**
 * The PRIMARY command (brief: "instant capture — one keystroke, saved,
 * done"). Raycast closes IMMEDIATELY — the save runs in the background and a
 * HUD reports the outcome once it settles, so the window never lingers on the
 * network round-trip.
 *
 * Two deliberate quiet paths (no HUD at all): if nothing resolves to a valid
 * http(s) URL — no supported frontmost browser tab AND no URL on the clipboard
 * (or an invalid one) — there's nothing to save, so Raycast just closes
 * silently. `resolveUrl()` already returns `undefined` for both the "no URL"
 * and "not a valid http(s) URL" cases (it validates via `isHttpUrl`), so the
 * one `undefined` branch covers both.
 *
 * A HUD only ever fires for the outcome of an ATTEMPTED save: success, dedup,
 * or a real save failure (silo unreachable / server error). Enrichment happens
 * in silo's backend and this command does NOT wait for or gate on it.
 */
export default async function Command(): Promise<void> {
  const resolved = await resolveUrl();

  // Nothing valid to save → close silently, no error HUD (per design: an
  // invalid/absent URL is a no-op, not an error worth interrupting for).
  if (!resolved) {
    await closeMainWindow({ popToRootType: PopToRootType.Immediate });
    return;
  }

  // Close first so Raycast never lingers on the request; the HUD below still
  // fires afterward (a HUD is a desktop overlay, independent of the window).
  await closeMainWindow({ popToRootType: PopToRootType.Immediate });

  try {
    const { deduped } = await captureLink({ url: resolved.url });
    await showHUD(deduped ? '✓ Already in silo (updated)' : '✓ Saved to silo');
  } catch (error) {
    const message = error instanceof CaptureError ? error.message : 'Could not save to silo';
    await showHUD(`✗ ${message}`);
  }
}
