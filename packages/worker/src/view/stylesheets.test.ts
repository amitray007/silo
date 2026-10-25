import { describe, expect, it, vi } from 'vitest';
import { inlinePageStyles } from './stylesheets.js';
import { resolveCss } from './transform.js';

const url = 'https://site.test/page';
function fetcher(sheets: Record<string, string>, mime = 'text/css') {
  return vi.fn(async (target: string) =>
    sheets[target] === undefined
      ? { ok: false as const, reason: 'http-error' as const }
      : {
          ok: true as const,
          html: sheets[target],
          contentType: mime,
          finalUrl: target,
          status: 200,
        },
  );
}

describe('bounded server-side stylesheets', () => {
  it('keeps order and media, rewrites URLs against each sheet, drops integrity/CORS', async () => {
    const fetch = fetcher({
      'https://site.test/css/a.css':
        '@import/**/ "nested/b.css" screen; .a{background:url(../a.png)}',
      'https://site.test/css/nested/b.css': '@im\\70ort "too-deep.css"; .b{background:url(b.png)}',
      'https://site.test/c.css': '.c{color:red}',
    });
    const output = await inlinePageStyles(
      '<link rel="stylesheet" href="/css/a.css" media="print" crossorigin integrity="hash"><link rel="stylesheet" href="/c.css"><link rel="stylesheet" data-href="/inactive.css">',
      url,
      fetch,
    );
    expect(output).toContain('<style media="print">');
    expect(output).toContain('@media screen{');
    expect(output).toContain('https://site.test/css/nested/b.png');
    expect(output).toContain('https://site.test/a.png');
    expect(output.indexOf('.b{')).toBeLessThan(output.indexOf('.a{'));
    expect(output.indexOf('.a{')).toBeLessThan(output.indexOf('.c{'));
    expect(output).not.toMatch(/@import|crossorigin|integrity|href="[^"]+\.css/);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('keeps links on fetch failure or non-CSS MIME', async () => {
    expect(
      await inlinePageStyles('<link rel="stylesheet" href="/bad.css">', url, fetcher({})),
    ).toContain('<link');
    expect(
      await inlinePageStyles(
        '<link rel="stylesheet" href="/bad.css">',
        url,
        fetcher({ 'https://site.test/bad.css': '<script>x</script>' }, 'text/html'),
      ),
    ).toContain('<link');
  });
  it('caps sheets including imports, total accepted bytes, and concurrency', async () => {
    let active = 0;
    let peak = 0;
    const fetch = vi.fn(async (target: string) => {
      peak = Math.max(peak, ++active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      return {
        ok: true as const,
        html: 'a'.repeat(1024 * 1024),
        contentType: 'text/css',
        finalUrl: target,
        status: 200,
      };
    });
    const output = await inlinePageStyles(
      Array.from({ length: 20 }, (_, i) => `<link rel="stylesheet" href="/${i}.css">`).join(''),
      url,
      fetch,
    );
    expect(fetch.mock.calls.length).toBeLessThanOrEqual(15);
    expect(peak).toBeLessThanOrEqual(3);
    expect((output.match(/<style/g) ?? []).length).toBe(3);
    expect(output).toContain('<link');
  });
  it('strips executable declarations, including obfuscation', () => {
    const css = resolveCss(
      'p{color:red; width:expression(alert(1));background:url(javascript:evil);behavior:url(x);-moz-binding:url(x)}',
      url,
    );
    expect(css).toContain('color:red');
    expect(css).not.toMatch(/expression|javascript|behavior|-moz-binding/);
    expect(resolveCss('p{background:url(jav\\61script:evil)}', url)).not.toContain('evil');
    expect(resolveCss('p{background:url(vbscript:evil)}', url)).not.toContain('vbscript');
    expect(
      resolveCss(
        String.raw`p{background:url("java\
script:evil")}`,
        url,
      ),
    ).not.toContain('evil');
  });
});
