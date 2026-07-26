import { afterEach, describe, expect, it, vi } from 'vitest';
import * as captureClient from '../lib/capture-client.js';
import * as toast from '../lib/toast.js';
import { captureActiveTab, captureTab, runQuietCapture } from './capture-flow.js';

/** `chrome.tabs.query` is overloaded (callback vs. Promise); `vi.mocked` on the raw property
 * infers the callback signature and rejects a Promise-returning mock impl. Casting through
 * a narrow local type keeps the test call sites simple without weakening the module's own types. */
function mockTabsQuery(tabs: chrome.tabs.Tab[]): void {
  (
    chrome.tabs.query as unknown as { mockResolvedValueOnce: (v: chrome.tabs.Tab[]) => void }
  ).mockResolvedValueOnce(tabs);
}

describe('runQuietCapture', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('captures and shows a "saved" toast — never rendering enrichment state', async () => {
    vi.spyOn(captureClient, 'captureLink').mockResolvedValue({
      link: {
        id: 'new-id',
        url: 'https://example.com',
        title: null,
        notes: null,
        tags: [],
      },
      deduped: false,
    });
    vi.spyOn(captureClient, 'listTags').mockResolvedValue([]);
    const showToastSpy = vi.spyOn(toast, 'showToast').mockResolvedValue(undefined);

    await runQuietCapture({ url: 'https://example.com' }, 'Example', 7);

    expect(captureClient.listTags).not.toHaveBeenCalled();
    expect(showToastSpy).toHaveBeenCalledWith(7, {
      kind: 'saved',
      title: 'Example',
      url: 'https://example.com',
      linkId: 'new-id',
      tags: [],
    });
  });

  it('shows a "deduped" toast when the API folds into an existing link', async () => {
    vi.spyOn(captureClient, 'captureLink').mockResolvedValue({
      link: {
        id: 'existing-id',
        url: 'https://example.com',
        title: 'Example',
        notes: null,
        tags: [],
      },
      deduped: true,
    });
    vi.spyOn(captureClient, 'listTags').mockResolvedValue([]);
    const showToastSpy = vi.spyOn(toast, 'showToast').mockResolvedValue(undefined);

    await runQuietCapture({ url: 'https://example.com' }, 'Example', 7);

    expect(showToastSpy).toHaveBeenCalledWith(7, {
      kind: 'deduped',
      title: 'Example',
      url: 'https://example.com',
      linkId: 'existing-id',
      tags: [],
    });
  });

  it('shows an error toast and re-throws when the API is unreachable', async () => {
    const error = new captureClient.CaptureError('unreachable', 'Could not reach silo');
    vi.spyOn(captureClient, 'captureLink').mockRejectedValue(error);
    const showToastSpy = vi.spyOn(toast, 'showToast').mockResolvedValue(undefined);

    await expect(runQuietCapture({ url: 'https://example.com' }, 'Example', 7)).rejects.toBe(error);
    expect(showToastSpy).toHaveBeenCalledWith(7, {
      kind: 'error',
      title: 'Could not reach silo',
      url: 'https://example.com',
      linkId: '',
      tags: [],
    });
  });

  it('does not attempt to show a toast when tabId is undefined (e.g. a headless capture)', async () => {
    vi.spyOn(captureClient, 'captureLink').mockResolvedValue({
      link: {
        id: 'x',
        url: 'https://example.com',
        title: null,
        notes: null,
        tags: [],
      },
      deduped: false,
    });
    const showToastSpy = vi.spyOn(toast, 'showToast').mockResolvedValue(undefined);

    await runQuietCapture({ url: 'https://example.com' }, 'Example', undefined);

    expect(showToastSpy).not.toHaveBeenCalled();
  });
});

describe('captureActiveTab', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('captures the active tab of the current window', async () => {
    mockTabsQuery([{ id: 3, url: 'https://example.com', title: 'Example' } as chrome.tabs.Tab]);
    vi.spyOn(captureClient, 'captureLink').mockResolvedValue({
      link: {
        id: 'id-1',
        url: 'https://example.com',
        title: null,
        notes: null,
        tags: [],
      },
      deduped: false,
    });
    vi.spyOn(captureClient, 'listTags').mockResolvedValue([]);
    vi.spyOn(toast, 'showToast').mockResolvedValue(undefined);

    await captureActiveTab();

    expect(captureClient.captureLink).toHaveBeenCalledWith({ url: 'https://example.com' });
  });

  it('no-ops on a non-http(s) active tab (e.g. chrome://extensions)', async () => {
    mockTabsQuery([{ id: 3, url: 'chrome://extensions' } as chrome.tabs.Tab]);
    const captureSpy = vi.spyOn(captureClient, 'captureLink');

    await captureActiveTab();

    expect(captureSpy).not.toHaveBeenCalled();
  });

  it('no-ops when there is no active tab', async () => {
    mockTabsQuery([]);
    const captureSpy = vi.spyOn(captureClient, 'captureLink');

    await captureActiveTab();

    expect(captureSpy).not.toHaveBeenCalled();
  });
});

describe('captureTab', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('captures the supplied click-time tab without querying the current active tab', async () => {
    vi.spyOn(captureClient, 'captureLink').mockResolvedValue({
      link: {
        id: 'id-1',
        url: 'https://clicked.example',
        title: null,
        notes: null,
        tags: [],
      },
      deduped: false,
    });
    vi.spyOn(captureClient, 'listTags').mockResolvedValue([]);
    vi.spyOn(toast, 'showToast').mockResolvedValue(undefined);

    await captureTab({
      id: 3,
      url: 'https://clicked.example',
      title: 'Clicked page',
    } as chrome.tabs.Tab);

    expect(chrome.tabs.query).not.toHaveBeenCalled();
    expect(captureClient.captureLink).toHaveBeenCalledWith({ url: 'https://clicked.example' });
  });

  it('no-ops when the supplied tab is not capturable', async () => {
    const captureSpy = vi.spyOn(captureClient, 'captureLink');

    await captureTab({ id: 3, url: 'chrome://extensions' } as chrome.tabs.Tab);

    expect(chrome.tabs.query).not.toHaveBeenCalled();
    expect(captureSpy).not.toHaveBeenCalled();
  });
});
