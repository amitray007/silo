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
  // Raycast appear to "wait". A no-view command keeps running after its window
  // closes, so the resolve + save + HUD below all complete in the background.
  await closeMainWindow({ popToRootType: PopToRootType.Immediate });

  // Wait for macOS to actually hand focus BACK to the browser before reading
  // the frontmost app. `closeMainWindow` resolves the instant Raycast's window
  // is told to close — NOT when focus has finished transferring — so without
  // this settle delay, `isFrontmost` runs while Raycast (or a transitional
  // state) is still frontmost, no browser matches, and `resolveUrl` silently
  // falls back to a STALE clipboard URL (the page you were on before, not your
  // current tab — the exact "it saved the wrong URL" bug). ~200ms is
  // imperceptible here (the whole command already runs in the background after
  // the window closed) and reliably lets focus settle onto the browser.
  await new Promise((resolve) => setTimeout(resolve, 200));

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
