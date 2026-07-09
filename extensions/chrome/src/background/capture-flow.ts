import { CaptureError, captureLink, listTags } from '../lib/capture-client.js';
import { isCapturableUrl, tabDisplayTitle } from '../lib/tab-payload.js';
import { showToast } from '../lib/toast.js';
import type { CaptureRequest } from '../lib/types.js';

/**
 * The one quiet-capture path every entry point (toolbar click, keyboard
 * command, context menu) funnels through: POST, show the toast. Never
 * blocks on or renders enrichment (the brief's binding philosophy) — the
 * toast fires the instant the capture request settles, regardless of the
 * link's enrichment state. The saved `link.id` is threaded into the toast
 * payload so the edit card (clicking the toast) can target it via
 * `chrome.runtime.sendMessage`.
 */
export async function runQuietCapture(
  request: CaptureRequest,
  displayTitle: string,
  tabId: number | undefined,
): Promise<void> {
  try {
    const { link, deduped } = await captureLink(request);
    if (tabId !== undefined) {
      const tags = await listTags().catch(() => []);
      await showToast(tabId, {
        kind: deduped ? 'deduped' : 'saved',
        title: displayTitle,
        url: request.url,
        linkId: link.id,
        tags,
      });
    }
  } catch (error) {
    if (tabId !== undefined) {
      const message = error instanceof CaptureError ? error.message : 'Could not save to silo';
      await showToast(tabId, {
        kind: 'error',
        title: message,
        url: request.url,
        linkId: '',
        tags: [],
      });
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
