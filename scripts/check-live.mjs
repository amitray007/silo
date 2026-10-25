import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { PAGE_VIEW_HEADERS } from '../packages/api/src/page-view-headers.ts';

// Resolve the worker's installed loader without adding a second root dependency.
const require = createRequire(new URL('../packages/worker/package.json', import.meta.url));
const { register } = await import(require.resolve('tsx/esm/api'));
register();
const { safeFetch } = await import('../packages/worker/src/fetch/safe-fetch.ts');
const { createPageViewer } = await import('../packages/worker/src/view/viewer.ts');

const file = process.argv[2] ?? new URL('./live-sites.txt', import.meta.url);
const urls = [
  ...new Set(
    (await readFile(file, 'utf8'))
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#')),
  ),
];
if (!urls.length) throw new Error('The URL file contains no sites to check.');

const details = new Map();
const viewer = createPageViewer({
  fetch: async (url, signal) => {
    const result = await safeFetch(url, { signal });
    if (!result.ok && result.detail) details.set(url, result.detail);
    return result;
  },
});
let html = '';
const server = createServer((_request, response) => {
  response.writeHead(200, { ...PAGE_VIEW_HEADERS, 'Content-Type': 'text/html; charset=utf-8' });
  response.end(html);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;

// Count text below the fold too. Ignore page chrome and non-rendered stylesheet text.
async function measure(page) {
  return page.evaluate(() => {
    function isVisible(node, element) {
      // display:contents has no box of its own, but its text can still render.
      if (getComputedStyle(element).visibility !== 'visible') return false;
      while (getComputedStyle(element).display === 'contents' && element.parentElement)
        element = element.parentElement;
      if (!element.checkVisibility({ opacityProperty: true, visibilityProperty: true }))
        return false;
      const range = document.createRange();
      range.selectNodeContents(node);
      return Array.from(range.getClientRects()).some((rect) => rect.width > 0 && rect.height > 0);
    }
    const total = [];
    const visible = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const ignored = 'nav,header,footer,aside,script,style,template';
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const element = node.parentElement;
      if (!element || element.closest(ignored)) continue;
      const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      total.push(text);
      if (isVisible(node, element)) visible.push(text);
    }
    return { visible: visible.join(' ').length, total: total.join(' ').length };
  });
}

function cell(value) {
  return String(value)
    .replaceAll('|', '%7C')
    .replace(/[\r\n]+/g, ' ');
}
function print(row) {
  console.log(`| ${row.map(cell).join(' | ')} |`);
}

try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  print(['URL', 'Mode', 'Visible', 'Total', 'Ratio', 'Result']);
  print(['---', '---', '---:', '---:', '---:', '---']);
  for (const url of urls) {
    try {
      const result = await viewer.view({
        id: url,
        url,
        origin,
        signal: AbortSignal.timeout(30_000),
      });
      const { mode, reason, contentType } = result.frame;
      if (!result.html) {
        const note =
          reason ?? (contentType?.includes('html') ? 'transform-unavailable' : 'non-HTML');
        print([url, mode, '-', '-', '-', [note, details.get(url)].filter(Boolean).join(': ')]);
        if (note !== 'non-HTML' && note !== 'unsupported-content') process.exitCode = 1;
        continue;
      }
      html = result.html;
      await page.goto(`${origin}/view`, { waitUntil: 'load', timeout: 15_000 });
      const counts = await measure(page);
      const ratio = counts.total ? counts.visible / counts.total : 0;
      const thin = counts.visible < 200 || ratio < 0.25;
      const note = mode === 'view' && thin ? 'FAIL: under visibility threshold' : (reason ?? 'ok');
      print([url, mode, counts.visible, counts.total, `${(ratio * 100).toFixed(1)}%`, note]);
      if (mode === 'view' && thin) process.exitCode = 1;
    } catch (error) {
      print([url, 'error', '-', '-', '-', error instanceof Error ? error.message : String(error)]);
      process.exitCode = 1;
    }
  }
} finally {
  await viewer.close();
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
