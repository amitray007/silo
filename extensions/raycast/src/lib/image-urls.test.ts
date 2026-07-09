import { describe, expect, it } from 'vitest';
import { domainOf, faviconUrl, previewImageUrl } from './image-urls.js';

describe('image-urls', () => {
  it('builds a proxied favicon url from baseUrl + domain', () => {
    expect(faviconUrl('http://localhost:8787', 'github.com')).toBe(
      'http://localhost:8787/api/favicon?domain=github.com',
    );
  });
  it('builds a proxied preview-image url', () => {
    expect(previewImageUrl('http://localhost:8787', 'abc 1')).toBe(
      'http://localhost:8787/api/preview-image?linkId=abc%201',
    );
  });
  it('extracts hostname, and empty string for garbage', () => {
    expect(domainOf('https://sub.example.com/x')).toBe('sub.example.com');
    expect(domainOf('not a url')).toBe('');
  });
});
