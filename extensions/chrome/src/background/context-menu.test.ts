import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as captureFlow from './capture-flow.js';
import { handleContextMenuClick, registerContextMenus } from './context-menu.js';

describe('context-menu', () => {
  beforeEach(() => {
    vi.spyOn(captureFlow, 'runQuietCapture').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers a page-context and a link-context menu item', () => {
    registerContextMenus();
    expect(chrome.contextMenus.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'silo-save-page', contexts: ['page'] }),
    );
    expect(chrome.contextMenus.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'silo-save-link', contexts: ['link'] }),
    );
  });

  it('captures the link URL when the link-context item is clicked', async () => {
    await handleContextMenuClick(
      {
        menuItemId: 'silo-save-link',
        linkUrl: 'https://example.com/article',
      } as chrome.contextMenus.OnClickData,
      { id: 1, url: 'https://example.com' } as chrome.tabs.Tab,
    );

    expect(captureFlow.runQuietCapture).toHaveBeenCalledWith(
      { url: 'https://example.com/article' },
      'https://example.com/article',
      1,
    );
  });

  it('captures the page URL when the page-context item is clicked', async () => {
    await handleContextMenuClick(
      { menuItemId: 'silo-save-page' } as chrome.contextMenus.OnClickData,
      { id: 2, url: 'https://example.com/page', title: 'A Page' } as chrome.tabs.Tab,
    );

    expect(captureFlow.runQuietCapture).toHaveBeenCalledWith(
      { url: 'https://example.com/page' },
      'A Page',
      2,
    );
  });

  it('does not capture a link-context click on a non-http(s) link', async () => {
    await handleContextMenuClick(
      {
        menuItemId: 'silo-save-link',
        linkUrl: 'javascript:alert(1)',
      } as chrome.contextMenus.OnClickData,
      { id: 1 } as chrome.tabs.Tab,
    );
    expect(captureFlow.runQuietCapture).not.toHaveBeenCalled();
  });

  it('does not capture a page-context click on a non-http(s) tab', async () => {
    await handleContextMenuClick(
      { menuItemId: 'silo-save-page' } as chrome.contextMenus.OnClickData,
      { id: 1, url: 'chrome://newtab' } as chrome.tabs.Tab,
    );
    expect(captureFlow.runQuietCapture).not.toHaveBeenCalled();
  });
});
