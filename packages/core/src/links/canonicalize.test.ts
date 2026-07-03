import { describe, expect, it } from 'vitest';
import { canonicalize } from './canonicalize.js';

describe('canonicalize', () => {
  describe('happy path — tracking params', () => {
    it('strips utm_ and fbclid params', () => {
      const result = canonicalize('https://example.com/page?utm_source=x&fbclid=y');
      expect(result.ok).toBe(true);
      expect(result.canonical).toBe('https://example.com/page');
    });

    it('canonicalizes two tracking-param variants of the same page identically', () => {
      const a = canonicalize('https://example.com/page?utm_source=newsletter&utm_medium=email');
      const b = canonicalize('https://example.com/page?gclid=abc123&msclkid=def456');
      expect(a.ok).toBe(true);
      expect(b.ok).toBe(true);
      expect(a.canonical).toBe(b.canonical);
      expect(a.canonical).toBe('https://example.com/page');
    });

    it('strips the full tracking-param vocabulary (unambiguous trackers only)', () => {
      const raw =
        'https://example.com/p?gbraid=1&wbraid=2&dclid=3&mc_cid=4&mc_eid=5&yclid=6&igshid=7&_hsenc=8&_hsmi=9';
      const result = canonicalize(raw);
      expect(result.ok).toBe(true);
      expect(result.canonical).toBe('https://example.com/p');
    });

    it('strips tracking params case-insensitively (FBCLID, Gclid, not just lowercase)', () => {
      const a = canonicalize('https://example.com/p?FBCLID=x&id=1');
      const b = canonicalize('https://example.com/p?fbclid=y&id=1');
      expect(a.canonical).toBe('https://example.com/p?id=1');
      expect(a.canonical).toBe(b.canonical);
    });

    it('PRESERVES page-defining params that are not unambiguous trackers (ref, spm)', () => {
      // ref/spm are frequently page-defining (product variants, item paths).
      // Stripping them would FALSE-MERGE distinct links and destroy data, so
      // they are deliberately kept — a missed dedup only leaves a duplicate.
      const red = canonicalize('https://shop.com/product?ref=red-variant');
      const blue = canonicalize('https://shop.com/product?ref=blue-variant');
      expect(red.canonical).not.toBe(blue.canonical);
      expect(canonicalize('https://item.taobao.com/i?spm=abc&id=5').canonical).toContain('spm=abc');
    });
  });

  describe('happy path — non-tracking params preserved', () => {
    it('preserves a page-defining param', () => {
      const result = canonicalize('https://example.com/watch?id=123');
      expect(result.ok).toBe(true);
      expect(result.canonical).toBe('https://example.com/watch?id=123');
    });

    it('sorts query params so order does not affect canonical form', () => {
      const a = canonicalize('https://example.com/p?a=1&b=2');
      const b = canonicalize('https://example.com/p?b=2&a=1');
      expect(a.ok).toBe(true);
      expect(b.ok).toBe(true);
      expect(a.canonical).toBe(b.canonical);
      expect(a.canonical).toBe('https://example.com/p?a=1&b=2');
    });

    it('preserves a non-tracking param alongside stripped tracking params', () => {
      const result = canonicalize('https://example.com/p?id=123&utm_source=x');
      expect(result.ok).toBe(true);
      expect(result.canonical).toBe('https://example.com/p?id=123');
    });
  });

  describe('edge — scheme / host / trailing slash normalization', () => {
    it('forces https so http and https variants canonicalize equal', () => {
      const a = canonicalize('http://example.com/page');
      const b = canonicalize('https://example.com/page');
      expect(a.ok).toBe(true);
      expect(b.ok).toBe(true);
      expect(a.canonical).toBe(b.canonical);
      expect(a.canonical).toBe('https://example.com/page');
    });

    it('strips www', () => {
      const result = canonicalize('https://www.example.com/page');
      expect(result.ok).toBe(true);
      expect(result.canonical).toBe('https://example.com/page');
    });

    it('strips a trailing slash', () => {
      const result = canonicalize('https://example.com/page/');
      expect(result.ok).toBe(true);
      expect(result.canonical).toBe('https://example.com/page');
    });

    it('strips the hash fragment', () => {
      const result = canonicalize('https://example.com/page#section');
      expect(result.ok).toBe(true);
      expect(result.canonical).toBe('https://example.com/page');
    });
  });

  describe('error path — malformed URLs never throw', () => {
    it('falls back to the raw string for plain garbage', () => {
      const result = canonicalize('not a url');
      expect(result.ok).toBe(false);
      expect(result.canonical).toBe('not a url');
    });

    it('falls back to the raw string for an empty string', () => {
      const result = canonicalize('');
      expect(result.ok).toBe(false);
      expect(result.canonical).toBe('');
    });

    it('rejects dangerous non-http(s) schemes as ok:false (security boundary)', () => {
      // The stored URL is later bound into an <a href> and exposed over MCP,
      // so javascript:/data:/vbscript: are stored-XSS sinks and file: is an
      // SSRF/LFR vector. canonicalize is the single trust boundary: reject
      // them here (ok:false) so the caller never treats them as a safe href
      // or a dedup key. The raw string is preserved so the item is still
      // saveable, just flagged unsafe.
      const dangerous = [
        'javascript:alert(1)',
        'data:text/html,<script>alert(1)</script>',
        'vbscript:msgbox(1)',
        'file:///etc/passwd',
        'ftp://example.com/file',
      ];
      for (const input of dangerous) {
        const result = canonicalize(input);
        expect(result.ok).toBe(false);
        expect(result.canonical).toBe(input);
      }
    });

    it('rejects over-length input as ok:false (bounds work at the write boundary)', () => {
      const result = canonicalize(`https://example.com/${'a'.repeat(9000)}`);
      expect(result.ok).toBe(false);
    });

    it('falls back to the raw string for whitespace-only input', () => {
      const result = canonicalize('   ');
      expect(result.ok).toBe(false);
      expect(result.canonical).toBe('   ');
    });

    it('does not throw for any malformed input', () => {
      const inputs = ['not a url', '', 'javascript:alert(1)', '   ', '://', 'http://', '?'];
      for (const input of inputs) {
        expect(() => canonicalize(input)).not.toThrow();
      }
    });
  });

  describe('adversarial', () => {
    it('handles an extremely long URL without throwing', () => {
      const longPath = 'a'.repeat(5000);
      const result = canonicalize(`https://example.com/${longPath}?utm_source=x`);
      expect(result.ok).toBe(true);
      expect(result.canonical).toBe(`https://example.com/${longPath}`);
    });

    it('handles a unicode/IDN domain', () => {
      const result = canonicalize('https://münchen.de/page');
      expect(result.ok).toBe(true);
      // IDN hosts are punycode-encoded by the URL parser.
      expect(result.canonical.startsWith('https://xn--')).toBe(true);
    });

    it('preserves an explicit non-default port', () => {
      const result = canonicalize('https://example.com:8443/page');
      expect(result.ok).toBe(true);
      expect(result.canonical).toBe('https://example.com:8443/page');
    });

    it('strips the default https port (443)', () => {
      const result = canonicalize('https://example.com:443/page');
      expect(result.ok).toBe(true);
      expect(result.canonical).toBe('https://example.com/page');
    });

    it('strips the hash fragment entirely, including any URL after it', () => {
      const result = canonicalize('https://example.com/page#/client-side/route?x=1');
      expect(result.ok).toBe(true);
      expect(result.canonical).toBe('https://example.com/page');
    });

    it('lowercases the host but preserves path case', () => {
      const result = canonicalize('https://EXAMPLE.com/Some/PATH');
      expect(result.ok).toBe(true);
      expect(result.canonical).toBe('https://example.com/Some/PATH');
    });

    it('rejects a data: URI as ok:false (non-http(s) scheme, security boundary)', () => {
      const result = canonicalize('data:text/plain;base64,SGVsbG8=');
      expect(result.ok).toBe(false);
      expect(result.canonical).toBe('data:text/plain;base64,SGVsbG8=');
    });

    it('falls back gracefully for a URL that is just a scheme', () => {
      const result = canonicalize('https://');
      expect(result.ok).toBe(false);
      expect(result.canonical).toBe('https://');
    });
  });
});
