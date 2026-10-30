import { type ChildProcess, spawn } from 'node:child_process';
import { createSocket, type Socket as UdpSocket } from 'node:dgram';
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createServer as createTcpServer, type Server as TcpServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import { chromium } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeReaderPool } from '../extract/reader-worker.js';
import { prepareGists } from '../extract/rich-blocks.js';
import { safeFetchBytes } from '../fetch/safe-fetch.js';
import { renderPage } from './page.js';
import { BrowserReader } from './reader.js';
import type { BrowserFetch } from './route.js';

const chromiumInstalled = existsSync(chromium.executablePath());
if (!chromiumInstalled && ['1', 'true'].includes(process.env.CI_REQUIRE_BROWSER ?? ''))
  throw new Error('CI_REQUIRE_BROWSER is set but Chromium is missing; refusing to skip');
const describeWithChromium = chromiumInstalled ? describe : describe.skip;

async function listen(handler: (request: IncomingMessage, response: ServerResponse) => void) {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture-address');
  return { server, port: address.port };
}
function closeServer(server?: Server) {
  return new Promise<void>((resolve, reject) => {
    if (!server) {
      resolve();
      return;
    }
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections();
  });
}
async function runServer(): Promise<{ process: ChildProcess; endpoint: string }> {
  const launcher = fileURLToPath(new URL('./server.mjs', import.meta.url));
  const child = spawn(process.execPath, [launcher], {
    env: { ...process.env, SILO_BROWSER_HOST: '127.0.0.1', SILO_BROWSER_PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    const endpoint = await new Promise<string>((resolve, reject) => {
      let output = '';
      const timeout = setTimeout(() => {
        reject(new Error(`launcher startup timeout: ${output}`));
      }, 15_000);
      const fail = (error: Error) => {
        clearTimeout(timeout);
        reject(error);
      };
      child.once('error', fail);
      child.once('exit', (code) => fail(new Error(`launcher exited ${code}: ${output}`)));
      const read = (chunk: Buffer) => {
        output += chunk.toString();
        const endpoint = output.match(/Listening on (ws:\/\/\S+)/)?.[1];
        if (endpoint) {
          clearTimeout(timeout);
          resolve(endpoint);
        }
      };
      child.stdout?.on('data', read);
      child.stderr?.on('data', read);
    });
    return { process: child, endpoint };
  } catch (error) {
    child.kill('SIGTERM');
    throw error;
  }
}

// The allowance applies only to fixture.test. Direct loopback and metadata URLs
// still pass through production classification, without a loopback exception.
const fetchFixture: BrowserFetch = (url, options) =>
  safeFetchBytes(url, {
    ...options,
    ...(['fixture.test', 'localhost'].includes(new URL(url).hostname)
      ? {
          allowLoopbackForTests: true,
          resolver: async () => [{ address: '127.0.0.1', family: 4 }],
        }
      : {}),
  });
const article =
  'This article was built by JavaScript after the document loaded. It has enough useful prose to qualify as a complete Reader. '.repeat(
    20,
  );

describeWithChromium('rendered Reader through a hardened browser launcher', () => {
  let server: ChildProcess | undefined;
  let fixture: Server | undefined;
  let target: Server | undefined;
  let url: string;
  let targetPort: number;
  let reader: BrowserReader;
  let endpoint: string;
  let udp: UdpSocket;
  let turn: TcpServer;
  let stunPort: number;
  let turnPort: number;
  let directConnections = 0;
  let stunPackets = 0;
  let turnConnections = 0;
  const fixtureLog: string[] = [];
  const targetLog: string[] = [];
  const credentials: Array<{ cookie: string | undefined; authorization: string | undefined }> = [];
  const fetch = vi.fn(fetchFixture);
  let connections = 0;

  beforeAll(async () => {
    const trap = await listen((req, res) => {
      targetLog.push(`${req.method} ${req.url}`);
      res.end('target');
    });
    target = trap.server;
    target.on('connection', () => directConnections++);
    udp = createSocket('udp4');
    udp.on('message', () => stunPackets++);
    await new Promise<void>((resolve) => udp.bind(0, '127.0.0.1', resolve));
    stunPort = udp.address().port;
    turn = createTcpServer((socket) => {
      turnConnections++;
      socket.destroy();
    });
    await new Promise<void>((resolve) => turn.listen(0, '127.0.0.1', resolve));
    const address = turn.address();
    if (!address || typeof address === 'string') throw new Error('turn-address');
    turnPort = address.port;
    targetPort = trap.port;
    const site = await listen((req, res) => {
      fixtureLog.push(`${req.method} ${req.url}`);
      credentials.push({ cookie: req.headers.cookie, authorization: req.headers.authorization });
      res.setHeader(
        'content-type',
        req.url === '/article.js' ? 'application/javascript' : 'text/html',
      );
      switch (req.url) {
        case '/js-error':
          res.end(
            `<article><p>${article}</p></article><script>throw new Error('fixture-pageerror')</script>`,
          );
          break;
        case '/metadata':
          res.setHeader('content-type', 'application/json');
          res.setHeader('obs-status', 'success');
          res.setHeader('set-cookie', 'must-not-forward=1');
          res.end('{}');
          break;
        case '/status-reader':
          res.end(`<main><article><h1>Metadata driven article</h1><p>${article}</p></article></main><script>
            fetch('http://localhost:' + location.port + '/metadata', {credentials:'include'}).then(async response => {
              if (response.headers.get('obs-status') === 'success') document.querySelector('article').insertAdjacentHTML('beforeend', '<p>Publisher status was visible.</p>');
            });
            </script>`);
          break;
        case '/rich-blocks':
          res.end(`<main><article><h1>Rich blocks</h1><p>${article}</p>
            <pre><code class="language-typescript">const answer: number = 42;</code></pre>
            <pre><code class="language-mermaid">graph TD; A--&gt;B</code></pre>
            <div class="mermaid"><svg width="400" height="200"><text>Publisher diagram label</text></svg></div>
            <pre class="mermaid" data-processed="true">Processed diagram label</pre>
            <pre class="language-js"><svg width="16" height="16"></svg><code>const iconExample = true;</code></pre>
            <p>Inline $x^2$ and display $$y_1$$.</p>
            <div class="callout" data-callout="warning"><div class="callout-title">Careful</div><div class="callout-content"><p>Keep this warning body.</p></div></div>
            </article></main>`);
          break;
        case '/frames-redirect':
          res.writeHead(302, { location: '/frames' });
          res.end();
          break;
        case '/frames':
          res.end(`<main><article><h1>Article with embedded frames</h1><p>${article}</p>
            <iframe src="/embedded-document"></iframe>
            <iframe src="https://codepen.io/example/embed/abc123"></iframe>
            </article></main>`);
          break;
        case '/escape':
          res.end(`<main><article><h1>Isolation probes</h1><p>${article}</p></article></main><script>
          const worker = new SharedWorker(URL.createObjectURL(new Blob([
            "onconnect = ({ports: [port]}) => { port.postMessage('SharedWorker started'); fetch('http://127.0.0.1:${targetPort}/worker', {method: 'POST', body: 'hostile'}).then(() => port.postMessage('SharedWorker escaped')).catch(() => port.postMessage('SharedWorker blocked')); };"
          ], {type: 'application/javascript'})));
          worker.port.onmessage = event => document.querySelector('article').insertAdjacentHTML('beforeend', '<p>' + event.data + '</p>');
          worker.port.start();
          const peer = new RTCPeerConnection({iceServers: [
            {urls: 'stun:127.0.0.1:${stunPort}'},
            {urls: 'turn:127.0.0.1:${turnPort}?transport=tcp', username: 'test', credential: 'test'}
          ]});
          peer.createDataChannel('probe');
          peer.createOffer().then(offer => peer.setLocalDescription(offer)).then(() => {
            document.querySelector('article').insertAdjacentHTML('beforeend', '<p>WebRTC gathering started</p>');
          });
          </script>`);
          break;
        case '/csp':
          res.end(
            `<meta http-equiv="Content-Security-Policy" content="script-src 'self'"><main></main><script src="/article.js"></script>`,
          );
          break;
        case '/article.js':
          res.end(
            `document.querySelector('main').innerHTML = '<article><h1>Script built article</h1><p>${article}</p></article>';`,
          );
          break;
        case '/security':
          res.end(`<main></main><script src="/article.js"></script><script>
          fetch('http://127.0.0.1:${targetPort}/loopback').catch(() => {});
          fetch('http://169.254.169.254/latest/meta-data').catch(() => {});
          fetch('/post', { method: 'POST', body: 'must not leave' }).catch(() => {});
          navigator.sendBeacon('/beacon', 'must not leave');
          new WebSocket('ws://127.0.0.1:${targetPort}/websocket');
          document.cookie = 'publisher_cookie=secret';
          fetch('/json', {headers: {authorization: 'Bearer publisher-secret'}}).then(r => r.json()).then(data => {
            document.querySelector('article').insertAdjacentHTML('beforeend', '<p>' + data.marker + '</p>');
          });
        </script>`);
          break;
        case '/json':
          res.setHeader('content-type', 'application/json');
          res.setHeader('set-cookie', 'secret=should-not-propagate');
          res.end(JSON.stringify({ marker: 'Allowed JSON was fetched by the worker.' }));
          break;
        case '/amd':
          res.end(
            `<main><article><p>${article}</p></article></main><script>window.define = () => {}; window.define.amd = true; window.exports = {}; window.module = {exports:{}};</script>`,
          );
          break;
        case '/challenge':
          res.end('<title>Just a moment</title><main>Please verify you are a human</main>');
          break;
        case '/style.css':
          res.setHeader('content-type', 'text/css');
          res.end('img { width: 134px; height: 49px; } .hidden { display:none; }');
          break;
        case '/image-states':
          res.end(`<main><article><p>${article}</p>
          <img id="absent" src="/absent.png" style="width:134px;height:49px">
          <img id="empty" src="/empty.png" alt="" style="width:134px;height:0px">
          <img id="value" src="/value.png" alt="Exact alternative text" style="width:134px;height:49px">
          <img id="unknown" src="/unknown.png" alt="Long alternative text must not set the size">
          <img id="declared" src="/declared.png" width="80" height="65" alt="Declared size">
          <img id="height-only" src="/height-only.png" height="65" style="width:134px;height:49px">
          <img id="latex-alt" src="/latex-alt.png" width="16" height="16" alt="\\alpha">
          <img id="loaded-small" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16'%3E%3Crect width='16' height='16'/%3E%3C/svg%3E">
          <img id="loaded" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='147'%3E%3Crect width='400' height='147' fill='red'/%3E%3C/svg%3E" style="width:134px;height:49px">
          </article></main>`);
          break;
        case '/image-filter':
          res.end(`<link rel="stylesheet" href="/style.css"><main><article><p>${article}</p>
          <img src="/unknown-size.png" alt="Article illustration" class="unknown-size">
          <img src="/declared-size.png" width="80" height="65" alt="Article diagram">
          <img src="/small-icon.png" width="16" height="16" alt="Icon">
          <img src="/stylesheet-size.png" alt="CSS sized badge">
          <img src="/equation.png" width="16" height="16" alt="\\alpha">
          </article></main><style>.unknown-size { width:auto; height:auto; }</style>`);
          break;
        case '/small-images':
          res.end(`<main><article><p>${article}</p>
          <img src="/inline-icon.png" style="width:32px;height:60px">
          <img src="/boundary.png" width="33" height="33">
          <img src="/hint-icon.png" srcset="/hint-icon.png?w=32 1x, /hint-icon.png?w=64 2x">
          <img src="/latex-class.png" width="16" height="16" class="latex">
          <img src="/tex-class.png" width="16" height="16" class="tex">
          <img src="/data-latex.png" width="16" height="16" data-latex="x">
          <img src="/data-math.png" width="16" height="16" data-math="x">
          <svg viewBox="0 0 16 16"><title>Small SVG icon</title><rect width="16" height="16"/></svg>
          <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16'%3E%3Crect width='16' height='16'/%3E%3C/svg%3E">
          </article></main>`);
          break;
        case '/styled':
          res.end(
            `<link rel="stylesheet" href="/style.css"><main><article><h1>Article with CSS</h1><p>${article}</p><p class="hidden">CSS hidden secret must not be in reader</p><img src="/never-download.png" width="400" height="147" alt="badge"></article></main>`,
          );
          break;
        default:
          res.end('<main></main><script src="/article.js"></script>');
      }
    });
    fixture = site.server;
    url = `http://fixture.test:${site.port}`;
    const running = await runServer();
    server = running.process;
    endpoint = running.endpoint;
    reader = new BrowserReader(running.endpoint, {
      fetch,
      connect: async (endpoint) => {
        connections++;
        return chromium.connect(endpoint);
      },
    });
  }, 25_000);

  afterAll(async () => {
    await reader?.close();
    await closeReaderPool();
    if (server && server.exitCode === null && server.signalCode === null) {
      const exited = new Promise<void>((resolve) => server?.once('exit', () => resolve()));
      server.kill('SIGTERM');
      const force = setTimeout(() => server?.kill('SIGKILL'), 2_000);
      await exited;
      clearTimeout(force);
    }
    udp?.close();
    if (turn) await new Promise<void>((resolve) => turn.close(() => resolve()));
    await Promise.all([closeServer(fixture), closeServer(target)]);
  });

  it('records page errors in render diagnostics', async () => {
    const result = await reader.run(`${url}/js-error`);
    expect(result).toMatchObject({ diagnostics: { errors: ['fixture-pageerror'] } });
  });

  it('builds a Reader from scripts delivered through the route proxy and reuses one connection', async () => {
    expect(await reader.run(`${url}/article`)).toMatchObject({
      text: expect.stringContaining('built by JavaScript'),
      reader: { contentHtml: expect.stringContaining('built by JavaScript') },
    });
    expect(await reader.run(`${url}/another`)).toMatchObject({
      text: expect.stringContaining('complete Reader'),
    });
    expect(connections).toBe(1);
    expect(fixtureLog).toContain('GET /article.js');
  }, 25_000);

  it('renders the main article without fetching embedded documents and preserves embed placeholders', async () => {
    const result = await reader.run(`${url}/frames-redirect`);
    expect(result?.text).toContain('complete Reader');
    expect(fixtureLog).toContain('GET /frames-redirect');
    expect(fixtureLog).toContain('GET /frames');
    expect(fixtureLog).not.toContain('GET /embedded-document');
    expect(
      fetch.mock.calls.some(
        ([url]) => url.endsWith('/embedded-document') || url.includes('codepen.io'),
      ),
    ).toBe(false);
    const { document } = parseHTML(result?.reader?.contentHtml ?? '');
    expect(document.querySelectorAll('figure[data-silo-embed]')).toHaveLength(2);
    expect(
      document.querySelector('a[href="https://codepen.io/example/embed/abc123"]'),
    ).not.toBeNull();
  }, 25_000);

  it('preserves public publisher status headers on cross-origin fetches', async () => {
    const result = await reader.run(`${url}/status-reader`);
    expect(result?.reader?.contentHtml).toContain('Publisher status was visible.');
  }, 25_000);

  it('stores languages, leftover TeX and callouts through the real rendered path', async () => {
    const result = await reader.run(`${url}/rich-blocks`);
    const { document } = parseHTML(result?.reader?.contentHtml ?? '');
    expect(document.querySelector('code[data-lang="typescript"]')?.textContent).toContain(
      'const answer',
    );
    expect(document.querySelector('code[data-lang="mermaid"]')?.textContent).toContain('graph TD');
    expect(document.querySelectorAll('pre > code[data-lang="mermaid"]')).toHaveLength(1);
    expect(document.querySelector('code[data-lang="js"]')?.textContent).toContain('iconExample');
    expect(document.querySelectorAll('math')).toHaveLength(2);
    expect(document.querySelector('[data-callout="warning"]')?.textContent).toContain(
      'Keep this warning body',
    );
    expect(document.querySelector('[data-callout-title="Careful"]')).not.toBeNull();
  }, 25_000);

  it('injects Gist preparation without transpiler helpers and removes duplicate publisher output', async () => {
    const browser = await chromium.connect(endpoint);
    const context = await browser.newContext({ javaScriptEnabled: true });
    try {
      const page = await context.newPage();
      await page.route('**/*', (route) => route.abort());
      await page.setContent(
        '<article><div class="gist">Old code</div><script src="https://gist.github.com/a/abc123.js?file=one.ts"></script><link rel="stylesheet" href="https://github.githubassets.com/gist.css"><div class="gist">Next old code</div></article>',
      );
      await page.evaluate(`(${prepareGists.toString()})(document)`);
      expect(await page.locator('code[data-lang="silo-gist"]').textContent()).toBe(
        'https://gist.github.com/a/abc123?file=one.ts',
      );
      expect(await page.locator('.gist').count()).toBe(0);
    } finally {
      await context.close();
      await browser.close();
    }
  }, 25_000);

  it.each([
    ['cm6', 'function greet() {\n  const text = "<hello>";\n\n\treturn text;  \n}\n'],
    ['cm5', 'if (ready) {\n  run();\n}'],
    ['monaco', 'const value: number = 1;\n  console.log(value);'],
    ['github', 'if (ready) {\n  run();\n}'],
    ['rouge', 'if ready\n  run\nend\n'],
    ['pygments', 'if ready:\n    run()\n'],
    [
      'shopify',
      "const authorizationDetails = JSON.stringify([\n  {\n    type: 'urn:shopify:shop_app:data-sharing:v1',\n    datatypes: [\n      {name: 'phone_number', required: true},\n      {name: 'birthdate', required: false},\n    ],\n  },\n]);",
    ],
  ])(
    'normalizes a script-built %s editor through rendered extraction',
    async (name, text) => {
      const snippet = readFileSync(
        new URL(`../extract/__fixtures__/code-editor-${name}.html`, import.meta.url),
        'utf8',
      );
      const html = `<main><article><p>${article}</p></article></main><script>
      document.querySelector('article').insertAdjacentHTML('beforeend', ${JSON.stringify(snippet)});
      </script>`;
      const browser = await chromium.connect(endpoint);
      try {
        const result = await renderPage(
          browser,
          `${url}/editor`,
          AbortSignal.timeout(20_000),
          async () => ({
            ok: true,
            status: 200,
            finalUrl: `${url}/editor`,
            bytes: Buffer.from(html),
            contentType: 'text/html',
          }),
        );
        const { document } = parseHTML(result.reader?.contentHtml ?? '');
        expect(document.querySelectorAll('pre > code')).toHaveLength(1);
        expect(document.querySelector('code')?.textContent).toBe(text);
        expect(result.text).toContain(text);
        expect(result.text).not.toMatch(/silo-editor-|Copy sample|Duplicate/);
        expect(result.diagnostics.errors).toEqual([]);
      } finally {
        await browser.close();
      }
    },
    25_000,
  );

  it('blocks loopback, metadata, WebSockets and POST before they reach their targets', async () => {
    const result = await reader.run(`${url}/security`);
    expect(result?.text).toContain('Allowed JSON was fetched by the worker.');
    expect(fixtureLog).toContain('GET /json');
    expect(fixtureLog.some((entry) => entry.startsWith('POST '))).toBe(false);
    expect(fixtureLog.some((entry) => entry.includes('/post') || entry.includes('/beacon'))).toBe(
      false,
    );
    expect(targetLog).toEqual([]);
    expect(
      credentials.every(
        (headers) => headers.cookie === undefined && headers.authorization === undefined,
      ),
    ).toBe(true);
    const blocked = await Promise.all(
      fetch.mock.calls.map(async ([url], index) => ({
        url,
        result: await fetch.mock.results[index]?.value,
      })),
    );
    expect(blocked).toContainEqual({
      url: `http://127.0.0.1:${targetPort}/loopback`,
      result: expect.objectContaining({ ok: false, reason: 'blocked-ip' }),
    });
    expect(blocked).toContainEqual({
      url: 'http://169.254.169.254/latest/meta-data',
      result: expect.objectContaining({ ok: false, reason: 'blocked-ip' }),
    });
    expect(
      fetch.mock.calls.some(
        ([url]) => url.endsWith('/post') || url.endsWith('/beacon') || url.includes('/websocket'),
      ),
    ).toBe(false);
  }, 25_000);

  it('honors computed CSS without overwriting declared dimensions on unloaded images', async () => {
    const result = await reader.run(`${url}/styled`);
    expect(result?.reader?.contentHtml).toContain('width="400"');
    expect(result?.reader?.contentHtml).toContain('height="147"');
    expect(result?.text).not.toContain('CSS hidden secret');
    expect(fixtureLog).not.toContain('GET /never-download.png');
  }, 25_000);

  it('keeps aborted article images and math, removes icons, and records stylesheet sizes', async () => {
    const result = await reader.run(`${url}/image-filter`);
    const { document } = parseHTML(result?.reader?.contentHtml ?? '');
    const images = [...document.querySelectorAll('img')].map((image) => ({
      path: new URL(image.getAttribute('src') ?? '', url).pathname,
      width: image.getAttribute('width'),
      height: image.getAttribute('height'),
    }));
    expect(images).toEqual([
      { path: '/unknown-size.png', width: null, height: null },
      { path: '/declared-size.png', width: '80', height: '65' },
      { path: '/stylesheet-size.png', width: '134', height: '49' },
    ]);
    // Defuddle converts the retained equation image into MathML, not raw TeX text.
    expect(document.querySelector('math mi')?.textContent).toBe('α');
    expect(document.querySelector('math')?.textContent).not.toContain('\\alpha');
    expect(fixtureLog.some((entry) => entry.endsWith('.png'))).toBe(false);
  }, 25_000);

  it('uses declared sizes, srcset hints, SVG sizes and loaded intrinsic sizes with math exceptions', async () => {
    const result = await reader.run(`${url}/small-images`);
    const { document } = parseHTML(result?.reader?.contentHtml ?? '');
    expect([...document.querySelectorAll('img')].map((image) => image.getAttribute('src'))).toEqual(
      ['boundary', 'latex-class', 'tex-class'].map((name) => `${url}/${name}.png`),
    );
    expect([...document.querySelectorAll('math')].map((math) => math.textContent)).toEqual([
      'x',
      'x',
    ]);
    expect(result?.reader?.contentHtml).not.toContain('Small SVG icon');
  }, 25_000);

  it('restores exact alt states, measures width-only boxes, and keeps the loaded-image rule', async () => {
    const browser = await chromium.connect(endpoint);
    const newContext = browser.newContext.bind(browser);
    let images: unknown;
    vi.spyOn(browser, 'newContext').mockImplementation(async (options) => {
      const context = await newContext(options);
      const newPage = context.newPage.bind(context);
      vi.spyOn(context, 'newPage').mockImplementation(async () => {
        const page = await newPage();
        const evaluate = page.evaluate.bind(page);
        vi.spyOn(page, 'evaluate').mockImplementation(async (expression) => {
          if (typeof expression === 'string' && expression.startsWith('(() =>')) {
            // Observe dimensions and alt states at the extraction boundary in real Chromium.
            await evaluate(`(() => {
              const Original = window.Defuddle;
              window.Defuddle = class extends Original {
                parse() {
                  window.imageProbe = [...document.querySelectorAll('img')].map(image => ({
                    id: image.id, alt: image.getAttribute('alt'),
                    width: image.getAttribute('width'), height: image.getAttribute('height'),
                    naturalWidth: image.naturalWidth,
                  }));
                  return super.parse();
                }
              };
            })()`);
            const result = await evaluate(expression);
            images = await evaluate('window.imageProbe');
            return result;
          }
          return evaluate(expression);
        });
        return page;
      });
      return context;
    });
    try {
      const result = await renderPage(
        browser,
        `${url}/image-states`,
        AbortSignal.timeout(20_000),
        fetchFixture,
      );
      expect(result.reader).toBeDefined();
      expect(images).toEqual([
        { id: 'absent', alt: null, width: '134', height: '49', naturalWidth: 0 },
        { id: 'empty', alt: '', width: '134', height: null, naturalWidth: 0 },
        { id: 'value', alt: 'Exact alternative text', width: '134', height: '49', naturalWidth: 0 },
        {
          id: 'unknown',
          alt: 'Long alternative text must not set the size',
          width: null,
          height: null,
          naturalWidth: 0,
        },
        { id: 'declared', alt: 'Declared size', width: '80', height: '65', naturalWidth: 0 },
        { id: 'height-only', alt: null, width: '134', height: '65', naturalWidth: 0 },
        { id: 'latex-alt', alt: '\\alpha', width: '16', height: '16', naturalWidth: 0 },
        { id: 'loaded', alt: null, width: '134', height: '49', naturalWidth: 400 },
      ]);
    } finally {
      await browser.close();
    }
  }, 25_000);

  it('separates block cards and flex items while preserving inline and code text', async () => {
    const browser = await chromium.connect(endpoint);
    const html = `<style>.card { display:flex } .separate { display:inline-flex }</style>
      <article><a href="/course"><div>01</div><div>Electricity</div><div>47 lessons</div></a>
      <a href="/flex" class="card"><span>01</span><span>Electricity</span><span>47 lessons</span></a>
      <a href="/inline"><span class="separate">01</span><span class="separate">Electricity</span><span class="separate">47 lessons</span></a>
      <p><b>foo</b>bar</p><pre><code><span class="separate">foo</span><span class="separate">bar</span></code></pre></article>`;
    try {
      const result = await renderPage(
        browser,
        `${url}/spacing`,
        AbortSignal.timeout(20_000),
        async () => ({
          ok: true,
          status: 200,
          finalUrl: `${url}/spacing`,
          bytes: Buffer.from(html),
          contentType: 'text/html',
        }),
      );
      const { document } = parseHTML(result.reader?.contentHtml ?? '');
      expect([...document.querySelectorAll('a')].map((a) => a.textContent)).toEqual([
        '01 Electricity 47 lessons',
        '01 Electricity 47 lessons',
        '01 Electricity 47 lessons',
      ]);
      expect(result.text).toContain('foobar');
      expect(document.querySelector('code')?.textContent).toBe('foobar');
    } finally {
      await browser.close();
    }
  }, 25_000);

  it('injects the browser UMD even when publishers expose AMD or CommonJS globals', async () => {
    expect((await reader.run(`${url}/amd`))?.text).toContain('built by JavaScript');
  }, 25_000);

  it('extracts under a meta CSP without inline script injection', async () => {
    expect((await reader.run(`${url}/csp`))?.text).toContain('built by JavaScript');
  }, 25_000);

  it('blocks WebRTC STUN/TURN and SharedWorker traffic outside context.route', async () => {
    // localhost is a secure context, so SharedWorker and WebRTC really run.
    const local = url.replace('fixture.test', 'localhost');
    // Positive control: without launch isolation these same probes reach all traps.
    const control = await chromium.launchServer({ host: '127.0.0.1', port: 0 });
    const browser = await chromium.connect(control.wsEndpoint());
    try {
      await renderPage(browser, `${local}/escape`, AbortSignal.timeout(20_000), fetchFixture);
      expect(directConnections).toBeGreaterThan(0);
      expect(stunPackets).toBeGreaterThan(0);
      expect(turnConnections).toBeGreaterThan(0);
    } finally {
      await browser.close();
      await control.close();
    }
    directConnections = 0;
    stunPackets = 0;
    turnConnections = 0;
    const result = await reader.run(`${local}/escape`);
    expect(result?.text).toContain('SharedWorker started');
    expect(result?.text).toContain('SharedWorker blocked');
    expect(result?.text).toContain('WebRTC gathering started');
    expect(result?.text).toContain('built by JavaScript');
    expect(directConnections).toBe(0);
    expect(stunPackets).toBe(0);
    expect(turnConnections).toBe(0);
    expect(fetch.mock.calls.some(([url]) => url.includes('/worker'))).toBe(false);
  }, 25_000);

  it('rejects the challenge specifically before extraction', async () => {
    const browser = await chromium.connect(endpoint);
    try {
      await expect(
        renderPage(browser, `${url}/challenge`, AbortSignal.timeout(20_000), fetchFixture),
      ).rejects.toThrow('browser-challenge');
    } finally {
      await browser.close();
    }
  }, 25_000);
});
