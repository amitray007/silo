import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { addDarkPageStyle, pageHasDarkScript, pageHasDarkTheme } from './dark-theme.js';
import { inlinePageStyles } from './stylesheets.js';
import { transformPage } from './transform.js';

function hasDarkTheme(html: string): boolean {
  const dom = new JSDOM(html);
  try {
    return pageHasDarkTheme(dom.window.document);
  } finally {
    dom.window.close();
  }
}

describe('native page dark theme detection', () => {
  it.each([
    ['(prefers-color-scheme: dark)', true],
    ['not (prefers-color-scheme: dark)', false],
    ['not all and (prefers-color-scheme: dark)', false],
    ['(prefers-color-scheme: light)', false],
    ['not (prefers-color-scheme: light)', false],
    ['not all and (prefers-color-scheme: dark), (prefers-color-scheme: light)', false],
    ['not all and (prefers-color-scheme: dark), (prefers-color-scheme: dark)', true],
    ['(prefers-color-scheme: light), screen and (prefers-color-scheme: dark)', true],
    ['NOT ALL AND (prefers-color-scheme: dark)', false],
  ])('evaluates media query polarity for %s', async (media, expected) => {
    for (const html of [
      `<style>@media ${media}{body{color:white}}</style>`,
      `<style media="${media}">body{color:white}</style>`,
      `<link rel="stylesheet" href="/missing.css" media="${media}">`,
    ]) {
      expect(hasDarkTheme(html)).toBe(expected);
      const page = await inlinePageStyles(html, 'https://publisher.test/', async () => ({
        ok: false,
        reason: 'http-error',
      }));
      expect(page.cssDarkTheme).toBe(expected);
    }
  });

  it.each([
    '@layer theme{@supports (color:white){@media (prefers-color-scheme:dark){body{color:white}}}}',
    '@container article (width > 10px){@media (prefers-color-scheme:dark){body{color:white}}}',
    '@media (prefers-color-scheme:dark){@container article (width > 10px){body{color:white}}}',
  ])('finds bounded candidates in inert styles: %s', async (css) => {
    const page = await inlinePageStyles(
      `<style type="text/silo-css">.unused{content:"color-scheme:dark;{}"}${css}</style>`,
      'https://publisher.test/',
    );
    expect(page.cssDarkTheme).toBe(true);
  });

  it.each([
    '.missing{color-scheme:dark}',
    'body{content:"color-scheme:dark;light-dark(black,white)"}',
    '/* body{color-scheme:dark} */body{color:black}',
    '@keyframes unused{from{color-scheme:dark}}',
    '@media not all and (prefers-color-scheme:dark){body{color:white}}',
  ])('keeps candidate filtering and selector matching for inert CSS: %s', async (css) => {
    const page = await inlinePageStyles(
      `<style type="text/silo-css">${css}</style>`,
      'https://publisher.test/',
    );
    expect(page.cssDarkTheme).toBe(false);
  });

  it('caps candidate bytes across sheets and keeps the serialized styles intact', async () => {
    const css = `.missing{color-scheme:dark;--padding:${'é'.repeat(70_000)}}`;
    const one = await inlinePageStyles(
      `<style type="text/silo-css">${css}</style>`,
      'https://publisher.test/',
    );
    expect(one.cssDarkTheme).toBe(false);
    const two = await inlinePageStyles(
      `<style type="text/silo-css">${css}</style>`.repeat(2),
      'https://publisher.test/',
    );
    expect(two.cssDarkTheme).toBe(true);
    expect(two.html).toContain(`<style>${css}</style><style>${css}</style>`);
  });

  it('treats an oversized dark media block as native support', async () => {
    const css = `@media (prefers-color-scheme:dark){.missing{--padding:${'x'.repeat(270_000)}}}`;
    const page = await inlinePageStyles(
      `<style type="text/silo-css">${css}</style>`,
      'https://publisher.test/',
    );
    expect(page.cssDarkTheme).toBe(true);
  });

  it.each([
    '<style>@media (prefers-color-scheme: dark) { body { color: white } }</style>',
    '<style media="(prefers-color-scheme:dark)">body {color:white}</style>',
    '<style>body { color: light-dark(black, white) }</style>',
    '<style>:root { COLOR-SCHEME: light dark; }</style>',
    '<div style="color-scheme: dark light"></div>',
    '<meta content="light dark" name="color-scheme">',
    '<META NAME="COLOR-SCHEME" CONTENT="only dark">',
    '<style>@media (prefers-color-\\73 cheme: dark) {body{color:white}}</style>',
    '<style>@layer theme {@supports (color: white) {@media (prefers-color-scheme: dark) {body{color:white}}}}</style>',
    '<style>@media (prefers-color-scheme: dark) {@layer theme {@supports (color: white) {body{color:white}}}}</style>',
    '<style>@media (prefers-color-scheme: dark) {body:unknown-selector{color:white}}</style>',
  ])('recognizes publisher evidence in %s', (html) => {
    expect(hasDarkTheme(html)).toBe(true);
  });

  it.each([
    '',
    '<h1>Light page</h1>',
    '<style>body { color-scheme: only light }</style>',
    '<meta name="color-scheme" content="light">',
    '<p>prefers-color-scheme: dark and light-dark(black, white)</p>',
    '<style>/* color-scheme: dark; */ body {color:black}</style>',
    '<style>body::after {content:"light-dark(black, white); color-scheme: dark"}</style>',
    '<style>body {background: url("color-scheme: dark")}</style>',
    '<style>.dark {color:white}</style>',
    '<style>:root {color-scheme:var(--dark-mode)}</style>',
    '<style>:root {--color-scheme:dark}</style>',
    '<style>@media (prefers-color-scheme: dark) {}</style>',
    '<style>@media (prefers-color-scheme: dark) {.missing:hover {color:white}}</style>',
    '<style>.missing {color-scheme:dark; color:light-dark(black,white)}</style>',
    '<style>[data-name=":hover"] {color-scheme:dark}</style>',
    '<style type="application/json">body{color-scheme:dark}</style>',
  ])('does not infer support from %s', (html) => {
    expect(hasDarkTheme(html)).toBe(false);
  });

  it('detects dark CSS fetched from an external stylesheet after transformation', async () => {
    const page = await inlinePageStyles(
      '<link rel="stylesheet" href="/theme.css"><p>Article</p>',
      'https://publisher.test/article',
      async () => ({
        ok: true,
        finalUrl: 'https://publisher.test/theme.css',
        contentType: 'text/css',
        html: '@media (prefers-color-scheme: dark) {body {color:white}}',
        status: 200,
      }),
    );
    expect(page.cssDarkTheme).toBe(true);
  });

  it.each([
    [
      'Wikipedia',
      '<html class="skin-theme-clientpref-day"><head><style>@media (prefers-color-scheme:dark){html.skin-theme-clientpref-os{color:white}}</style></head><body>Article</body></html>',
      false,
      false,
    ],
    [
      'GitHub',
      '<html data-color-mode="auto" data-dark-theme="dark"><head><meta name="color-scheme" content="light dark"><style>@media (prefers-color-scheme:dark){[data-color-mode=auto][data-dark-theme=dark]{color:white}}</style></head><body>Article</body></html>',
      true,
      false,
    ],
    [
      'GitHub without meta',
      '<html data-color-mode="auto" data-dark-theme="dark"><head><style>@media (prefers-color-scheme:dark){[data-color-mode=auto][data-dark-theme=dark]{color:white}}</style></head><body>Article</body></html>',
      true,
      false,
    ],
    [
      'react.dev',
      '<html><head><style>html.dark{color-scheme:dark}</style><script>if(matchMedia("(prefers-color-scheme: dark)").matches)document.documentElement.classList.add("dark")</script></head><body>Article</body></html>',
      false,
      true,
    ],
    [
      'MDN',
      '<style>@media (prefers-color-scheme:dark){:root{--text-color:white}}</style>',
      true,
      false,
    ],
    ['plain', '<h1>Article</h1>', false, false],
    [
      'hover',
      '<style>@media (prefers-color-scheme:dark){a:hover:focus-visible::before{color:white}}</style><a href="/">Article</a>',
      true,
      false,
    ],
    [
      'remaining link media',
      '<link rel="stylesheet" href="/missing.css" media="(prefers-color-scheme:dark)">',
      true,
      false,
    ],
    [
      'removed SVG CSS',
      '<svg><style>:root{color-scheme:dark}</style></svg><p>Article</p>',
      false,
      false,
    ],
    [
      'external script',
      '<script src="/theme.js">matchMedia("prefers-color-scheme")</script><p>Article</p>',
      false,
      false,
    ],
    [
      'script-like prose',
      '<p>prefers-color-scheme</p><script>const mode = "light";</script>',
      false,
      false,
    ],
  ])(
    'detects CSS and raw script signals for %s',
    async (_name, html, cssDarkTheme, scriptDarkTheme) => {
      const page = await inlinePageStyles(html, 'https://publisher.test/article', async () => ({
        ok: false,
        reason: 'http-error',
      }));
      expect(page.cssDarkTheme).toBe(cssDarkTheme);
      expect(page.scriptDarkTheme).toBe(scriptDarkTheme);
      expect(page.html).not.toContain('<script');
    },
  );

  it('preserves safe color-scheme metadata through sanitization', () => {
    const html = transformPage(
      '<meta name="color-scheme" content="light dark"><meta http-equiv="refresh" content="0;url=https://bad.test"><p>Article</p>',
      'https://publisher.test/article',
    );
    expect(hasDarkTheme(html)).toBe(true);
    expect(html).toContain('name="color-scheme"');
    expect(html).not.toContain('http-equiv');
  });
});

describe('publisher script dark theme detection', () => {
  it.each([
    [undefined, true],
    ['', true],
    ['  ', false],
    ['module', true],
    [' MODULE ', true],
    ['text/javascript', true],
    ['application/javascript', true],
    ['text/ecmascript', true],
    ['application/ecmascript', true],
    ['application/x-javascript', true],
    ['text/javascript1.5', true],
    ['application/ld+json', false],
    ['application/json', false],
    ['importmap', false],
    ['speculationrules', false],
    ['text/plain', false],
    ['text/javascript; charset=utf-8', false],
  ])('only counts executable inline scripts with type %s', (type, expected) => {
    const dom = new JSDOM(
      `<script${type === undefined ? '' : ` type="${type}"`}>{"description":"prefers-color-scheme"}</script>`,
    );
    try {
      expect(pageHasDarkScript(dom.window.document)).toBe(expected);
    } finally {
      dom.window.close();
    }
  });
});

describe('view copy fallback dark stylesheet', () => {
  it('gates the root filter and white base on the framed page media preference', () => {
    const html = addDarkPageStyle('<html><head></head><body><p>Article</p></body></html>');
    const dom = new JSDOM(html);
    const style = dom.window.document.head.querySelector('style');
    expect(style?.textContent).toContain('@media (prefers-color-scheme: dark)');
    expect(style?.textContent).toContain('background: white');
    expect(style?.textContent).toContain('filter: invert(0.9) hue-rotate(180deg)');
    expect(dom.window.document.body.textContent).toBe('Article');
    dom.window.close();
  });

  it('re-inverts only the outer media element in each nested subtree', () => {
    const html = addDarkPageStyle(`<html><head></head><body>
      <img id="photo"><video id="video"></video><canvas id="canvas"></canvas>
      <iframe id="frame"></iframe><embed id="embed"><object id="object"></object>
      <svg><image id="svg-photo" /></svg>
      <div id="background" style="background-image:url(photo.png)">
        <img id="nested-photo"><div id="nested-background" style="background-image:url(other.png)"></div>
      </div></body></html>`);
    const dom = new JSDOM(html);
    const css = dom.window.document.querySelector('style')?.textContent ?? '';
    const selector = css.slice(css.indexOf(':is('), css.lastIndexOf('{')).trim();
    expect(Array.from(dom.window.document.querySelectorAll(selector), (el) => el.id)).toEqual([
      'photo',
      'video',
      'canvas',
      'frame',
      'embed',
      'object',
      'svg-photo',
      'background',
    ]);
    expect(css).toContain('filter: invert(1) hue-rotate(180deg)');
    dom.window.close();
  });
});
