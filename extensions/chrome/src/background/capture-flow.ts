import { CaptureError, captureLink } from '../lib/capture-client.js';
import { trackCapturedId } from '../lib/recent.js';
import { isCapturableUrl, tabDisplayTitle } from '../lib/tab-payload.js';
import { showToast } from '../lib/toast.js';
import type { CaptureRequest } from '../lib/types.js';

/**
 * The one quiet-capture path every entry point (toolbar click, keyboard
 * command, context menu) funnels through: POST, track the id for the
 * recent-5 list, show the toast. Never blocks on or renders enrichment (the
 * brief's binding philosophy) — the toast fires the instant the capture
 * request settles, regardless of the link's `captureStatus`.
 */
export async function runQuietCapture(
  request: CaptureRequest,
  displayTitle: string,
  tabId: number | undefined,
): Promise<void> {
  try {
    const { link, deduped } = await captureLink(request);
    await trackCapturedId(link.id);
    if (tabId !== undefined) {
      await showToast(tabId, { kind: deduped ? 'deduped' : 'saved', title: displayTitle });
    }
  } catch (error) {
    if (tabId !== undefined) {
      const message = error instanceof CaptureError ? error.message : 'Could not save to silo';
      await showToast(tabId, { kind: 'error', title: message });
    }
    throw error;
  }
}

/** Captures the active tab of the given window (toolbar action + keyboard command share this path). Silently no-ops on a non-http(s) tab — mirrors the brief's "non-http tabs disabled". */
export async function captureActiveTab(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !isCapturableUrl(tab.url)) return;
  await runQuietCapture({ url: tab.url }, tabDisplayTitle(tab), tab.id);
}
