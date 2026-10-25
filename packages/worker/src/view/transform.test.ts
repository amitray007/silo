import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { resolveCss, transformPage } from './transform.js';

const base = 'https://publisher.test/articles/story.html';
const payloads = [
  '<script>window.pwned=1</script>',
  '<img src="/x" onerror="alert(1)">',
  '<a href="javascript:alert(1)">bad</a>',
  '<a href="jav&#x61;script:alert(1)">bad</a>',
  '<a href="java&#x09;script:alert(1)">bad</a>',
  '<img data-src="java&#10;script:alert(1)" src="/ok">',
  '<noscript><img data-lazy-src="javascript:alert(1)" onerror="alert(1)"><script>evil()</script></noscript>',
  '<MeTa hTtP-eQuIv="ReFrEsH" content="0;url=javascript:alert(1)">',
  '<META HTTP-EQUIV="Content-Security-Policy" content="script-src *">',
  '<meta name="viewport" http-equiv="refresh" content="0;url=https://evil.test">',
  '<base href="https://evil.test"><a href="/safe">safe</a>',
  '<iframe srcdoc="<script>evil()</script>" src="https://evil.test"></iframe>',
  '<svg onload="evil()"><script>evil()</script><foreignObject><iframe srcdoc="evil"></iframe></foreignObject></svg>',
  '<math><mtext><table><mglyph><style><!--</style><img title="--><img src=x onerror=evil()>">',
  '<svg><a xlink:href="javascript:evil()">bad</a></svg>',
  '<a xmlns:x="urn:test" x:href="javascript:evil()" href="/ok" ping="/ping" download="a" rel="opener external">ok</a>',
  '<form action="/delete"><input type="submit" formaction="/delete"><button onclick="evil()">Go</button><textarea>x</textarea></form>',
  '<object data="/evil"><embed src="/evil"></object><template><script>evil()</script></template>',
  '<video src="data:text/html,evil" poster="javascript:evil()"><source src="file:///etc/passwd"></video>',
  '<link rel="preload" href="/api/delete"><link rel="stylesheet preload" href="/style.css">',
];

describe('final-DOM page sanitizer', () => {
  it.each(payloads)('removes active content: %s', (payload) => {
    const output = transformPage(payload, base);
    const dom = new JSDOM(output);
    try {
      const doc = dom.window.document;
      expect(
        doc.querySelector(
          'script,iframe,frame,object,embed,form,input,button,textarea,select,template,svg,math,base,noscript',
        ),
      ).toBeNull();
      expect(doc.querySelector('meta[http-equiv],link[rel="preload"]')).toBeNull();
      for (const element of doc.querySelectorAll('*')) {
        for (const attribute of element.attributes) {
          expect(attribute.name).not.toMatch(/^on|:|^(srcdoc|ping|download)$/i);
          if (['src', 'href', 'poster'].includes(attribute.name))
            expect(attribute.value).toMatch(/^https?:\/\//);
        }
      }
    } finally {
      dom.window.close();
    }
  });

  it('keeps layout, live styles/media and noscript images; resolves every URL without base', () => {
    const output = transformPage(
      `<!doctype html><html><head>
      <base href="https://evil.test/"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
      <style>@import '../theme.css'; .hero{background:url(../hero.png)}</style>
      <link rel="alternate stylesheet" href="../style.css"></head><body>
      <main class="layout" style="background-image:url('/bg.png')"><h1>Title</h1>
      <noscript><img data-src="../photo.jpg" onerror="evil()"></noscript>
      <picture><source data-srcset="../large.webp 2x, /small.webp 1x"><img data-lazy-src="/lazy.png"></picture>
      <video src="../movie.mp4" poster="../poster.jpg" controls><source src="/movie.webm"></video>
      <audio src="/audio.mp3" controls></audio><a href="#section" rel="opener external">jump</a>
      </main></body></html>`,
      base,
    );
    const dom = new JSDOM(output);
    try {
      const doc = dom.window.document;
      expect(doc.querySelector('main')?.classList.contains('layout')).toBe(true);
      expect(doc.querySelector('noscript,base,script')).toBeNull();
      expect(doc.querySelector('img')?.src).toBe('https://publisher.test/photo.jpg');
      expect(doc.querySelector('picture img')?.getAttribute('src')).toBe(
        'https://publisher.test/lazy.png',
      );
      expect(doc.querySelector('source')?.srcset).toBe(
        'https://publisher.test/large.webp 2x, https://publisher.test/small.webp 1x',
      );
      expect(doc.querySelector('link')?.href).toBe('https://publisher.test/style.css');
      expect(doc.querySelector('link')?.rel).toBe('stylesheet');
      expect(doc.querySelector('style')?.textContent).toContain('https://publisher.test/theme.css');
      expect(doc.querySelector('style')?.textContent).toContain('https://publisher.test/hero.png');
      expect(doc.querySelector('main')?.getAttribute('style')).toContain(
        'https://publisher.test/bg.png',
      );
      expect(doc.querySelector('video')?.poster).toBe('https://publisher.test/poster.jpg');
      expect(doc.querySelector('audio')?.src).toBe('https://publisher.test/audio.mp3');
      expect(doc.querySelector('a')?.outerHTML).toBe(
        '<a href="https://publisher.test/articles/story.html#section" rel="noopener noreferrer" target="_blank">jump</a>',
      );
      expect(doc.querySelector('meta[charset]')).not.toBeNull();
      expect(doc.querySelector('meta[name="viewport"]')).not.toBeNull();
    } finally {
      dom.window.close();
    }
  });

  it('allows raster data images only, and removes non-http CSS and srcset targets', () => {
    const output = transformPage(
      `<img src="data:image/png;base64,AAAA"><a href="data:image/png;base64,AAAA">bad</a>
      <img src="data:image/svg+xml,<svg onload='evil()'>"><source srcset="javascript:evil 1x, /ok.jpg 2x">
      <style>p {background:url(javascript:evil)} @import "data:text/css,evil";</style>`,
      base,
    );
    expect(output).toContain('src="data:image/png;base64,AAAA"');
    expect(output).not.toMatch(/href="data:|src="data:image\/svg|javascript:|data:text/);
    expect(output).toContain('https://publisher.test/ok.jpg 2x');
  });
});

describe('CSS resource token decoding', () => {
  it.each([
    String.raw`u\72l(../image.png)`,
    String.raw`\75\72\6c(../image\2e png)`,
    `URL(/**/'../image.png'/**/)`,
    `url(/**/"../image.png"/**/)`,
    `url(/**/../image.png/**/)`,
    String.raw`url(../im\61ge.png)`,
  ])('rewrites %s in sheets and inline CSS', (value) => {
    expect(resolveCss(`.x{background:${value}}`, base)).toContain(
      'url("https://publisher.test/image.png")',
    );
    const output = transformPage(
      `<style>.x{background:${value}}</style><p style='background:${value.replaceAll("'", '&#39;')}'>x</p>`,
      base,
    );
    const dom = new JSDOM(output);
    try {
      expect(dom.window.document.querySelector('style')?.textContent).toContain(
        'https://publisher.test/image.png',
      );
      expect(dom.window.document.querySelector('p')?.getAttribute('style')).toContain(
        'https://publisher.test/image.png',
      );
    } finally {
      dom.window.close();
    }
  });
  it.each([
    String.raw`u\72l("jav\61script:evil")`,
    `url(/**/vbscript:evil/**/)`,
    String.raw`u\72l('java\000009script:evil')`,
    `url('data:text/html,evil')`,
    `url('file:///evil')`,
  ])('strips decoded dangerous URL %s', (value) => {
    const output = resolveCss(`p{color:red;background:${value};color:blue}`, base);
    expect(output).not.toContain('evil');
    expect(output).toContain('color:red');
    expect(output).toContain('color:blue');
  });
  it('keeps punctuation and literal URL syntax inside quoted strings inert', () => {
    const output = resolveCss(
      String.raw`p{content:'url(../literal.png); @import "fake.css"';background:url('../a\"b.png')}`,
      base,
    );
    expect(output).toContain(`content:'url(../literal.png); @import "fake.css"'`);
    expect(output).toContain('https://publisher.test/a%22b.png');
  });
});

describe('script-gated article visibility', () => {
  it('reveals a large inline gate and leaves a small hidden menu untouched', () => {
    const dom = new JSDOM(
      transformPage(
        `<div id="article" hidden
      style="visibility:hidden;opacity:0;display:none;color:red">${'Article text. '.repeat(40)}</div>
      <nav hidden style="display:none;visibility:hidden;opacity:0">Menu</nav>`,
        base,
      ),
    );
    try {
      const article = dom.window.document.querySelector<HTMLElement>('#article');
      expect(article?.hidden).toBe(false);
      expect(article?.style.visibility).toBe('');
      expect(article?.style.opacity).toBe('');
      expect(article?.style.display).toBe('');
      expect(article?.style.color).toBe('red');
      expect(article?.classList.contains('silo-view-shown')).toBe(true);
      const menu = dom.window.document.querySelector('nav');
      expect(menu?.hidden).toBe(true);
      expect(menu?.style.display).toBe('none');
      expect(menu?.style.visibility).toBe('hidden');
      expect(menu?.style.opacity).toBe('0');
      expect(menu?.classList.contains('silo-view-shown')).toBe(false);
    } finally {
      dom.window.close();
    }
  });
  it.each([
    '<html class="async-hide"><head><style>.async-hide{opacity:0!important}</style></head>',
    '<html hidden style="visibility:hidden"><head><style>body{display:none}</style></head>',
  ])('overrides root script gates with the final stylesheet: %s', (head) => {
    const dom = new JSDOM(
      transformPage(
        `${head}<body hidden style="opacity:0;display:none">
      <article>${'Article text. '.repeat(40)}</article></body></html>`,
        base,
      ),
    );
    try {
      const doc = dom.window.document;
      expect(doc.documentElement.hidden).toBe(false);
      expect(doc.documentElement.classList.contains('silo-view-shown')).toBe(true);
      expect(doc.body.hidden).toBe(false);
      expect(doc.body.style.display).toBe('');
      const override = doc.body.lastElementChild?.textContent;
      expect(override).toContain('.silo-view-shown.silo-view-shown');
      expect(override).toContain('visibility: visible !important');
      expect(override).toContain('opacity: 1 !important');
      expect(override).toContain('display: block !important');
      expect(doc.body.lastElementChild?.localName).toBe('style');
    } finally {
      dom.window.close();
    }
  });
});
