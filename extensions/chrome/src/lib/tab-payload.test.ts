import { describe, expect, it } from 'vitest';
import { isCapturableUrl, tabDisplayTitle, tabToCaptureRequest } from './tab-payload.js';

function fakeTab(overrides: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab {
  return { url: 'https://example.com', title: 'Example', ...overrides } as chrome.tabs.Tab;
}

describe('isCapturableUrl', () => {
  it('allows http(s) URLs', () => {
    expect(isCapturableUrl('https://example.com')).toBe(true);
    expect(isCapturableUrl('http://example.com')).toBe(true);
  });

  it('rejects chrome://, about:, file:, and other internal schemes', () => {
    expect(isCapturableUrl('chrome://extensions')).toBe(false);
    expect(isCapturableUrl('about:blank')).toBe(false);
    expect(isCapturableUrl('file:///Users/x/file.html')).toBe(false);
    expect(isCapturableUrl('chrome-extension://abc/popup.html')).toBe(false);
  });

  it('rejects undefined/empty/unparseable URLs', () => {
    expect(isCapturableUrl(undefined)).toBe(false);
    expect(isCapturableUrl('')).toBe(false);
    expect(isCapturableUrl('not a url')).toBe(false);
  });
});

describe('tabToCaptureRequest', () => {
  it('maps a capturable tab to { url }', () => {
    const request = tabToCaptureRequest(fakeTab({ url: 'https://example.com/page' }));
    expect(request).toEqual({ url: 'https://example.com/page' });
  });

  it('returns undefined for a non-capturable tab', () => {
    expect(tabToCaptureRequest(fakeTab({ url: 'chrome://newtab' }))).toBeUndefined();
  });
});

describe('tabDisplayTitle', () => {
  it('uses the tab title when present', () => {
    expect(tabDisplayTitle(fakeTab({ title: 'Hello World' }))).toBe('Hello World');
  });

  it('falls back to the URL when the title is empty/whitespace', () => {
    expect(tabDisplayTitle(fakeTab({ title: '   ', url: 'https://example.com' }))).toBe(
      'https://example.com',
    );
  });

  it('falls back to a generic label when both title and url are missing', () => {
    expect(tabDisplayTitle(fakeTab({ title: undefined, url: undefined }))).toBe('this page');
  });
});
