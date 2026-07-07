import { isCapturableUrl } from '../lib/tab-payload.js';
import { runQuietCapture } from './capture-flow.js';

const MENU_ID_PAGE = 'silo-save-page';
const MENU_ID_LINK = 'silo-save-link';

/** Registers the two context-menu items (brief: "Save to silo" on a link + on the page). Called once from the service worker's `onInstalled`. */
export function registerContextMenus(): void {
  chrome.contextMenus.create({
    id: MENU_ID_PAGE,
    title: 'Save to silo',
    contexts: ['page'],
    documentUrlPatterns: ['http://*/*', 'https://*/*'],
  });
  chrome.contextMenus.create({
    id: MENU_ID_LINK,
    title: 'Save link to silo',
    contexts: ['link'],
    targetUrlPatterns: ['http://*/*', 'https://*/*'],
  });
}

/** Handles a context-menu click: page-context captures `tab.url`, link-context captures `info.linkUrl`. */
export async function handleContextMenuClick(
  info: chrome.contextMenus.OnClickData,
  tab: chrome.tabs.Tab | undefined,
): Promise<void> {
  if (info.menuItemId === MENU_ID_LINK && isCapturableUrl(info.linkUrl)) {
    await runQuietCapture({ url: info.linkUrl }, info.linkUrl, tab?.id);
    return;
  }
  if (info.menuItemId === MENU_ID_PAGE && tab && isCapturableUrl(tab.url)) {
    await runQuietCapture({ url: tab.url }, tab.title?.trim() || tab.url, tab.id);
  }
}
