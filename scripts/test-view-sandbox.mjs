import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from 'playwright';
import { PAGE_VIEW_HEADERS } from '../packages/api/src/page-view-headers.ts';
import { transformPage } from '../packages/worker/src/view/transform.ts';

const sandbox = 'allow-popups allow-popups-to-escape-sandbox';
const probes = [];
let origin;
const server = createServer((req, res) => {
  const path = new URL(req.url, origin).pathname;
  if (path.startsWith('/probe')) probes.push(path);
  if (path === '/parent') {
    res.setHeader('Content-Type', 'text/html');
    res.end(
      `<script>localStorage.setItem('silo-secret', 'private')</script><iframe title="view" sandbox="${sandbox}" src="/view"></iframe>`,
    );
  } else if (path === '/popup') {
    res.setHeader('Content-Type', 'text/html');
    res.end('<h1>Ordinary page</h1><script>window.popupRan=true</script>');
  } else if (path === '/view' || path === '/raw') {
    res.writeHead(200, { ...PAGE_VIEW_HEADERS, 'Content-Type': 'text/html; charset=utf-8' });
    const html = `<h1>Sandbox proof</h1><script>window.ran=true;fetch('/probe-script')</script>
      <img src="/probe-image" onerror="window.handlerRan=true">
      <a href="/popup">Open ordinary page</a><form action="/probe-form"><input type="submit"></form>`;
    res.end(path === '/raw' ? html : transformPage(html, `${origin}/view`));
  } else {
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jL1sAAAAASUVORK5CYII=',
        'base64',
      ),
    );
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
origin = `http://127.0.0.1:${server.address().port}`;

async function checkIsolation(frame, parentExpected) {
  const observed = await frame.evaluate(async (parentExpected) => {
    function denied(read) {
      try {
        read();
        return false;
      } catch {
        return true;
      }
    }
    let fetchBlocked = false;
    try {
      await fetch('/probe-fetch');
    } catch {
      fetchBlocked = true;
    }
    return {
      script: window.ran === undefined && window.handlerRan === undefined,
      cookie: denied(() => document.cookie),
      storage: denied(() => localStorage.getItem('silo-secret')),
      parent: !parentExpected || denied(() => parent.document.body),
      fetchBlocked,
    };
  }, parentExpected);
  assert.deepEqual(observed, {
    script: true,
    cookie: true,
    storage: true,
    parent: true,
    fetchBlocked: true,
  });
}

// Keep macOS Firefox test bookkeeping separate from the user's protected Firefox data.
// https://github.com/microsoft/playwright/issues/42768
let firefoxApp;
async function launchOptions(name) {
  if (name !== 'firefox' || process.platform !== 'darwin') return { headless: true };
  const cache = fileURLToPath(new URL('../node_modules/.cache/', import.meta.url));
  await mkdir(cache, { recursive: true });
  firefoxApp = await mkdtemp(join(cache, 'silo-sandbox-firefox-'));
  const resources = join(dirname(firefox.executablePath()), '../Resources');
  const ini = (await readFile(join(resources, 'application.ini'), 'utf8'))
    .replace(/^Vendor=.*$/m, 'Vendor=SiloPageViewTests')
    .replace(/^Name=.*$/m, 'Name=SiloPageViewTests');
  await writeFile(join(firefoxApp, 'application.ini'), ini);
  await symlink(join(resources, 'browser/omni.ja'), join(firefoxApp, 'omni.ja'));
  return {
    headless: true,
    env: { ...process.env, XUL_APP_FILE: join(firefoxApp, 'application.ini') },
  };
}

try {
  for (const [name, browserType] of Object.entries({ chromium, firefox, webkit })) {
    const browser = await browserType.launch(await launchOptions(name));
    try {
      const context = await browser.newContext();
      await context.addCookies([{ name: 'silo-test', value: 'private', url: origin }]);
      const page = await context.newPage();
      await page.goto(`${origin}/parent`);
      const frame = page.frames().find((frame) => frame.url() === `${origin}/view`);
      assert.ok(frame, 'silo view iframe loaded');
      await checkIsolation(frame, true);
      // A real click must open an ordinary unsandboxed page, without an opener.
      const popupReady = context.waitForEvent('page');
      await frame.getByRole('link', { name: 'Open ordinary page' }).click();
      const popup = await popupReady;
      await popup.waitForLoadState();
      assert.equal(await popup.evaluate(() => window.popupRan), true);
      assert.equal(await popup.evaluate(() => window.opener === null), true);
      assert.equal(await popup.evaluate(() => document.cookie.includes('silo-test=private')), true);
      await popup.close();
      // Headers protect even an untransformed document and a top-level navigation.
      await page.goto(`${origin}/raw`);
      await checkIsolation(page, false);
      await page.goto(`${origin}/view`);
      await checkIsolation(page, false);
      assert.ok(probes.includes('/probe-image'), 'permitted image GET is a positive control');
      assert.equal(
        probes.some((path) => ['/probe-script', '/probe-fetch', '/probe-form'].includes(path)),
        false,
      );
      console.log(
        `${name}: PASS - no script, cookies, storage, parent DOM or fetch; popup escapes with no opener; top-level isolated`,
      );
      await context.close();
    } finally {
      await browser.close();
    }
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
  if (firefoxApp) await rm(firefoxApp, { recursive: true, force: true });
}
