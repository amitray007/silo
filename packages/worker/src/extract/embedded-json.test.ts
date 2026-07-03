import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { recoverEmbeddedJson } from './embedded-json.js';

function domFor(html: string): JSDOM {
  return new JSDOM(html, { url: 'https://example.com/posts/hello' });
}

describe('recoverEmbeddedJson — __NEXT_DATA__', () => {
  it('recovers title/description/text from a well-formed __NEXT_DATA__ blob', () => {
    const html = `
      <html><body>
        <script id="__NEXT_DATA__" type="application/json">
        {
          "props": {
            "pageProps": {
              "post": {
                "title": "A Recovered Title",
                "description": "A recovered description.",
                "content": ${JSON.stringify('x'.repeat(250))}
              }
            }
          }
        }
        </script>
      </body></html>
    `;
    const result = recoverEmbeddedJson(domFor(html));
    expect(result).toBeDefined();
    expect(result?.source).toBe('next-data');
    expect(result?.title).toBe('A Recovered Title');
    expect(result?.description).toBe('A recovered description.');
    expect(result?.text).toHaveLength(250);
  });

  it('prefers a shallower match over a deeper one for the same field', () => {
    const html = `
      <html><body>
        <script id="__NEXT_DATA__" type="application/json">
        {
          "title": "Top Level Title",
          "props": { "pageProps": { "related": [{ "title": "Nested Unrelated Title" }] } }
        }
        </script>
      </body></html>
    `;
    const result = recoverEmbeddedJson(domFor(html));
    expect(result?.title).toBe('Top Level Title');
  });

  it('does not accept a short "content"-named field as text', () => {
    const html = `
      <html><body>
        <script id="__NEXT_DATA__" type="application/json">
        { "content": "too short" }
        </script>
      </body></html>
    `;
    const result = recoverEmbeddedJson(domFor(html));
    // "content" is too short to be accepted as body text, and there is no
    // title/description-shaped key either, so nothing is recoverable.
    expect(result).toBeUndefined();
  });

  it('returns undefined for malformed (non-JSON) __NEXT_DATA__ content', () => {
    const html = `
      <html><body>
        <script id="__NEXT_DATA__" type="application/json">{ not valid json </script>
      </body></html>
    `;
    expect(recoverEmbeddedJson(domFor(html))).toBeUndefined();
  });

  it('returns undefined when __NEXT_DATA__ is present but empty', () => {
    const html = `<html><body><script id="__NEXT_DATA__" type="application/json"></script></body></html>`;
    expect(recoverEmbeddedJson(domFor(html))).toBeUndefined();
  });
});

describe('recoverEmbeddedJson — __NUXT__', () => {
  it('recovers fields from a window.__NUXT__=... assignment', () => {
    const html = `
      <html><body>
        <script>
          window.__NUXT__={"data":[{"title":"Nuxt Recovered Title","description":"Nuxt description."}]}
        </script>
      </body></html>
    `;
    const result = recoverEmbeddedJson(domFor(html));
    expect(result?.source).toBe('nuxt');
    expect(result?.title).toBe('Nuxt Recovered Title');
    expect(result?.description).toBe('Nuxt description.');
  });

  it('best-effort skips a non-JSON IIFE-style __NUXT__ assignment without throwing', () => {
    const html = `
      <html><body>
        <script>window.__NUXT__=(function(a,b){return {title:a}})("x","y")</script>
      </body></html>
    `;
    expect(() => recoverEmbeddedJson(domFor(html))).not.toThrow();
    expect(recoverEmbeddedJson(domFor(html))).toBeUndefined();
  });
});

describe('recoverEmbeddedJson — neither blob present', () => {
  it('returns undefined for a plain page with no embedded JSON', () => {
    const html = '<html><body><p>just a normal page</p></body></html>';
    expect(recoverEmbeddedJson(domFor(html))).toBeUndefined();
  });

  it('prefers __NEXT_DATA__ over __NUXT__ when both are present', () => {
    const html = `
      <html><body>
        <script id="__NEXT_DATA__" type="application/json">{ "title": "Next Wins" }</script>
        <script>window.__NUXT__={"title":"Nuxt Loses"}</script>
      </body></html>
    `;
    const result = recoverEmbeddedJson(domFor(html));
    expect(result?.source).toBe('next-data');
    expect(result?.title).toBe('Next Wins');
  });
});
