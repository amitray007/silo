import { CaptureError, captureLink } from '../lib/capture-client.js';
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
      await showToast(tabId, {
        kind: deduped ? 'deduped' : 'saved',
        title: displayTitle,
        url: request.url,
        linkId: link.id,
        // Suggestions are loaded lazily if the user opens the edit card. A
        // second API round-trip must not delay the normal save confirmation.
        tags: [],
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

/**
 * Captures a tab snapshot supplied by the event that triggered the save.
 * Keeping the URL from click time means closing or switching tabs immediately
 * cannot make the asynchronous background flow capture a different page.
 */
export async function captureTab(tab: chrome.tabs.Tab): Promise<void> {
  if (!isCapturableUrl(tab.url)) return;
  await runQuietCapture({ url: tab.url }, tabDisplayTitle(tab), tab.id);
}

/**
 * Captures whichever tab is active when queried. This is only a fallback for
 * callers that do not receive a tab snapshot from Chrome.
 */
export async function captureActiveTab(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  await captureTab(tab);
}
