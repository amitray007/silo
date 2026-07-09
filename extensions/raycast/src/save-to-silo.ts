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
  // Close FIRST, before any work. URL resolution runs a chain of AppleScript
  // calls (frontmost-app detection across several browsers, then a tab read)
  // that can take hundreds of ms — doing it before the close is what made
  // Raycast appear to "wait". Closing up front also hands focus back to the
  // browser BEFORE `isFrontmost` runs, so tab detection is actually more
  // reliable. A no-view command keeps running after its window closes, so the
  // resolve + save + HUD below all complete in the background.
  await closeMainWindow({ popToRootType: PopToRootType.Immediate });

  const resolved = await resolveUrl();

  // Nothing valid to save → already closed, stay silent (an invalid/absent
  // URL is a no-op, not an error worth a HUD).
  if (!resolved) return;

  try {
    const { deduped } = await captureLink({ url: resolved.url });
    await showHUD(deduped ? '✓ Already in silo (updated)' : '✓ Saved to silo');
  } catch (error) {
    const message = error instanceof CaptureError ? error.message : 'Could not save to silo';
    await showHUD(`✗ ${message}`);
  }
}
