import { Response } from 'undici';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { safeFetch } from '../fetch/safe-fetch.js';
import { inlinePageStyles } from './stylesheets.js';

const { fetch } = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('undici', async (original) => ({
  ...(await original<typeof import('undici')>()),
  fetch,
}));
afterEach(() => {
  vi.restoreAllMocks();
  fetch.mockReset();
});

describe('shared stylesheet streaming budget', () => {
  it.each(['sheets', 'imports'])(
    'bounds bytes READ across concurrent %s and rejected MIME',
    async (mode) => {
      let bytesRead = 0;
      let active = 0;
      let peak = 0;
      let closed = 0;
      const originalRead = ReadableStreamBYOBReader.prototype.read;
      vi.spyOn(ReadableStreamBYOBReader.prototype, 'read').mockImplementation(async function (
        this: ReadableStreamBYOBReader,
        ...args: Parameters<typeof originalRead>
      ) {
        const result = await originalRead.apply(this, args);
        bytesRead += result.value?.byteLength ?? 0;
        return result;
      });
      const signals: AbortSignal[] = [];
      fetch.mockImplementation(async (url: URL, options: { signal: AbortSignal }) => {
        signals.push(options.signal);
        let sent = 0;
        peak = Math.max(peak, ++active);
        const small = url.pathname === '/root.css';
        const rootCss =
          mode === 'imports'
            ? '@import "big.css"; @import "wrong.css"; @import "big2.css"; .root{color:red}'
            : '.root{color:red}';
        const stream = new ReadableStream<Uint8Array>({
          type: 'bytes',
          async pull(controller) {
            await new Promise((resolve) => setTimeout(resolve, 1));
            if (options.signal.aborted) {
              controller.error(new Error('aborted'));
              return;
            }
            if (small) {
              controller.enqueue(new TextEncoder().encode(rootCss));
              controller.close();
              active--;
              return;
            }
            // Source chunks exceed the BYOB reservation; only requested bytes may be read.
            controller.enqueue(new Uint8Array(256 * 1024).fill(32));
            sent += 256 * 1024;
            if (sent === 4 * 1024 * 1024) {
              controller.close();
              active--;
            }
          },
          cancel() {
            active--;
            closed++;
          },
        });
        options.signal.addEventListener('abort', () => stream.cancel().catch(() => {}), {
          once: true,
        });
        return new Response(stream, {
          headers: { 'content-type': url.pathname === '/wrong.css' ? 'text/html' : 'text/css' },
        });
      });
      const output = await inlinePageStyles(
        mode === 'imports'
          ? '<link rel="stylesheet" href="/root.css">'
          : '<link rel="stylesheet" href="/root.css"><link rel="stylesheet" href="/big.css"><link rel="stylesheet" href="/wrong.css"><link rel="stylesheet" href="/big2.css">',
        'https://publisher.test/page',
        (url, options) =>
          safeFetch(url, {
            ...options,
            resolver: async () => [{ address: '93.184.216.34', family: 4 }],
          }),
        AbortSignal.timeout(5_000),
      );
      expect(bytesRead).toBe(3 * 1024 * 1024);
      expect(peak).toBe(3);
      expect(signals.some((signal) => signal.aborted)).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(4);
      expect(output).toContain('<style>');
      expect(output).toContain('.root{color:red}');
      expect(output).not.toContain('@import');
      expect(closed).toBeGreaterThanOrEqual(1);
    },
  );
});
