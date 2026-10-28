import { chromium } from 'playwright-core';
import type { PageContent } from '../extract/reader-page.js';
import { closeWithin } from './cleanup.js';
import { type BrowserPort, diagnosticMessage, type RenderDiagnostics, renderPage } from './page.js';
import type { BrowserFetch } from './route.js';

export type RenderOutcome = 'ok' | 'empty' | 'pending' | 'failed';
export type BrowserResult = PageContent & { renderPending?: true; renderOutcome?: RenderOutcome };
export interface BrowserReaderOptions {
  connect?: (endpoint: string) => Promise<BrowserPort>;
  fetch?: BrowserFetch;
  timeoutMs?: number;
  log?: (message: string) => void;
}
interface Job {
  url: string;
  signal: AbortSignal | undefined;
  resolve: (result: BrowserResult | undefined) => void;
  cancel: () => void;
}

function infrastructureFailure(error: unknown): boolean {
  return (
    error instanceof Error &&
    /browser-(connect|deadline|disconnected)|protocol error|target page, context or browser has been closed/i.test(
      error.message,
    )
  );
}

/** One connection, one active page, and at most ten waiting callers. */
export class BrowserReader {
  private browser: BrowserPort | undefined;
  private readonly queue: Job[] = [];
  private draining = false;
  private closed = false;
  private active: AbortController | undefined;
  private teardown: Promise<void> | undefined;
  private failures = 0;
  private retryAt = 0;

  constructor(
    private readonly endpoint: string,
    private readonly options: BrowserReaderOptions = {},
  ) {}

  run(url: string, signal?: AbortSignal): Promise<BrowserResult | undefined> {
    if (this.closed || signal?.aborted || this.queue.length >= 10) {
      this.resultLog(url, 'failed');
      return Promise.resolve(undefined);
    }
    return new Promise((resolve) => {
      const job: Job = { url, signal, resolve, cancel: () => {} };
      job.cancel = () => {
        const index = this.queue.indexOf(job);
        if (index !== -1) this.queue.splice(index, 1);
        signal?.removeEventListener('abort', job.cancel);
        this.resultLog(url, 'failed');
        resolve(undefined);
      };
      signal?.addEventListener('abort', job.cancel, { once: true });
      this.queue.push(job);
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      let job = this.queue.shift();
      while (job) {
        job.signal?.removeEventListener('abort', job.cancel);
        job.resolve(await this.runNext(job.url, job.signal));
        job = this.queue.shift();
      }
    } finally {
      this.draining = false;
    }
  }

  private async connection(signal: AbortSignal): Promise<BrowserPort> {
    if (this.browser?.isConnected()) return this.browser;
    const connect =
      this.options.connect ?? ((endpoint) => chromium.connect(endpoint, { timeout: 20_000 }));
    let browser: BrowserPort;
    try {
      browser = await connect(this.endpoint);
    } catch (cause) {
      throw new Error('browser-connect', { cause });
    }
    if (signal.aborted || this.closed) {
      await closeWithin(() => browser.close());
      throw new Error('browser-cancelled');
    }
    this.browser = browser;
    browser.on('disconnected', () => {
      if (this.browser !== browser) return;
      this.browser = undefined;
      this.active?.abort(new Error('browser-disconnected'));
    });
    return browser;
  }

  private async runNext(url: string, signal?: AbortSignal): Promise<BrowserResult | undefined> {
    if (this.closed || signal?.aborted) return undefined;
    if (Date.now() < this.retryAt) {
      this.resultLog(url, 'pending');
      return { renderPending: true, renderOutcome: 'pending' };
    }
    const diagnostics: RenderDiagnostics = {
      timings: { gotoMs: 0, settleMs: 0, extractMs: 0 },
      errors: [],
      bodyTextLength: 0,
      contentLength: 0,
    };
    const halfOpen = this.retryAt > 0;
    const controller = new AbortController();
    this.active = controller;
    const abort = () => controller.abort(new Error('browser-cancelled'));
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(
      () => controller.abort(new Error('browser-deadline')),
      this.options.timeoutMs ?? 20_000,
    );
    let onAbort: () => void = () => {};
    const cancelled = new Promise<never>((_, reject) => {
      onAbort = () => {
        const browser = this.browser;
        this.browser = undefined;
        // Disconnect also tears down a renderer that cannot process context.close().
        if (browser) this.teardown = closeWithin(() => browser.close());
        reject(controller.signal.reason);
      };
      controller.signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      const work = this.connection(controller.signal).then((browser) =>
        renderPage(browser, url, controller.signal, this.options.fetch, diagnostics),
      );
      const result = await Promise.race([work, cancelled]);
      this.healthy();
      const outcome = result.reader && result.text?.trim() ? 'ok' : 'empty';
      this.resultLog(url, outcome, diagnostics);
      return { ...result, renderOutcome: outcome };
    } catch (error) {
      const result = this.failed(error, halfOpen, signal);
      this.resultLog(url, 'failed', diagnostics);
      return { ...result, renderOutcome: 'failed' };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      controller.signal.removeEventListener('abort', onAbort);
      this.active = undefined;
      controller.abort();
    }
  }

  private resultLog(url: string, outcome: RenderOutcome, diagnostics?: RenderDiagnostics): void {
    let target = '[invalid]';
    try {
      const parsed = new URL(url);
      target = parsed.host + parsed.pathname.slice(0, 80);
    } catch {}
    console.debug(
      `[reader/browser] render result ${JSON.stringify({ outcome, target, ...diagnostics })}`,
    );
  }

  private failed(
    error: unknown,
    halfOpen: boolean,
    signal?: AbortSignal,
  ): BrowserResult | undefined {
    console.debug(
      '[reader/browser] render failed',
      error instanceof Error ? diagnosticMessage(error.message) : 'browser-error',
    );
    if (signal?.aborted || this.closed) return undefined;
    if (!infrastructureFailure(error)) {
      this.healthy();
      return undefined;
    }
    if (halfOpen || ++this.failures >= 3) {
      this.retryAt = Date.now() + 5 * 60_000;
      this.failures = 0;
      (this.options.log ?? console.warn)('[reader/browser] circuit open for 5 minutes');
    }
    return { renderPending: true };
  }

  private healthy(): void {
    this.failures = 0;
    this.retryAt = 0;
  }

  async close(): Promise<void> {
    this.closed = true;
    this.active?.abort(new Error('browser-cancelled'));
    for (const job of [...this.queue]) job.cancel();
    const browser = this.browser;
    this.browser = undefined;
    if (browser) await closeWithin(() => browser.close());
    await this.teardown;
  }
}

let reader: BrowserReader | undefined;
export function renderReader(
  url: string,
  signal?: AbortSignal,
): Promise<BrowserResult | undefined> {
  const endpoint = process.env.SILO_BROWSER_WS_ENDPOINT?.trim();
  if (!endpoint) return Promise.resolve(undefined);
  reader ??= new BrowserReader(endpoint);
  return reader.run(url, signal);
}

export async function closeBrowserReader(): Promise<void> {
  const current = reader;
  reader = undefined;
  await current?.close();
}
