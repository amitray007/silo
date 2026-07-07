import type { CaptureRequest } from './types.js';

/** Schemes a capture command may run against; every other scheme (chrome://, chrome-extension://, about:, file:, devtools://, edge://) is disabled — mirrors the API's own `canonicalize` http(s)-only guard, checked here first so the toolbar/keyboard/context-menu paths never even attempt an unreachable capture. */
const CAPTURABLE_SCHEMES = ['http:', 'https:'];

/** Whether a tab's URL is a scheme this extension can capture. */
export function isCapturableUrl(url: string | undefined): url is string {
  if (!url) return false;
  try {
    return CAPTURABLE_SCHEMES.includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

/** Maps a `chrome.tabs.Tab` to a capture request body. `title` is used only for the toast's display text — the API derives its own title via enrichment, so it is NOT sent as part of the request. */
export function tabToCaptureRequest(tab: chrome.tabs.Tab): CaptureRequest | undefined {
  if (!isCapturableUrl(tab.url)) return undefined;
  return { url: tab.url };
}

/** The page title to show in the toast — falls back to the bare URL when the tab has no title yet (e.g. a page still loading). */
export function tabDisplayTitle(tab: chrome.tabs.Tab): string {
  return tab.title?.trim() || tab.url || 'this page';
}
