import { describe, expect, it } from 'vitest';
import { TransformPool } from './pool.js';

describe('transform worker pool', () => {
  it.each(['', '@layer theme{@media (prefers-color-scheme:dark){.missing{color:white}}}'])(
    'returns HTML for a 2.8 MB staged stylesheet within the transform deadline (%s)',
    async (theme) => {
      const pool = new TransformPool();
      const css = '.x{color:red}'.repeat(235_000) + theme;
      expect(Buffer.byteLength(css)).toBeGreaterThan(2_800_000);
      const signal = new AbortController().signal;
      try {
        // Warm the thread so the pool's 3 s deadline measures the transform, not tsx startup.
        await pool.run('<p>Warm</p>', 'https://page.test/', signal);
        // Fetched sheets are staged with this inert type before the shared sanitizer runs.
        // A run past the deadline rejects with transform-timeout.
        const result = await pool.run(
          `<style type="text/silo-css">${css}</style><p>Article</p>`,
          'https://page.test/',
          signal,
        );
        expect(result.html).toContain('<p>Article</p>');
        expect(result.html).toContain(`<style>${css}</style>`);
        expect(result.cssDarkTheme).toBe(false);
      } finally {
        await pool.close();
      }
    },
  );
  it('transforms in real reusable worker threads', async () => {
    const pool = new TransformPool();
    try {
      const signal = new AbortController().signal;
      const results = await Promise.all([
        pool.run('<p>One<script>evil()</script></p>', 'https://page.test/', signal),
        pool.run('<img src="/photo.png">', 'https://other.test/', signal),
      ]);
      expect(results[0]?.html).toContain('<p>One</p>');
      expect(results[0]?.html).not.toContain('script');
      expect(results[1]?.html).toContain('https://other.test/photo.png');
      expect((await pool.run('<p>Reused</p>', 'https://page.test/', signal)).html).toContain(
        'Reused',
      );
    } finally {
      await pool.close();
    }
  });
  it('returns both signals from the real transform thread before scripts are removed', async () => {
    const pool = new TransformPool();
    try {
      const result = await pool.run(
        '<html><head><style>html.dark{color-scheme:dark}</style><script>matchMedia("(prefers-color-scheme: dark)")</script></head><body><p>Article</p></body></html>',
        'https://page.test/',
        new AbortController().signal,
      );
      expect(result.cssDarkTheme).toBe(false);
      expect(result.scriptDarkTheme).toBe(true);
      expect(result.html).not.toContain('<script');
      const native = await pool.run(
        '<style>@layer theme{@media (prefers-color-scheme: dark){body{color:white}}}</style>',
        'https://page.test/',
        new AbortController().signal,
      );
      expect(native.cssDarkTheme).toBe(true);
      expect(native.scriptDarkTheme).toBe(false);
    } finally {
      await pool.close();
    }
  });
  it('hard-terminates a non-yielding thread while the API event loop stays responsive', async () => {
    const pool = new TransformPool(
      100,
      new URL('../test-support/stuck-transform.mjs', import.meta.url),
    );
    const began = Date.now();
    let ticked = false;
    const timer = setTimeout(() => {
      ticked = true;
    }, 20);
    try {
      await expect(
        pool.run('ignored', 'https://page.test/', new AbortController().signal),
      ).rejects.toThrow('transform-timeout');
      expect(ticked).toBe(true);
      expect(Date.now() - began).toBeLessThan(2_000);
      // A second task gets a fresh thread and its own deadline.
      await expect(
        pool.run('ignored', 'https://page.test/', new AbortController().signal),
      ).rejects.toThrow('transform-timeout');
    } finally {
      clearTimeout(timer);
      await pool.close();
    }
  });
  it('terminates parsing on disconnect and refuses pre-aborted work', async () => {
    const pool = new TransformPool(
      3_000,
      new URL('../test-support/stuck-transform.mjs', import.meta.url),
    );
    const controller = new AbortController();
    try {
      const output = pool.run('ignored', 'https://page.test/', controller.signal);
      controller.abort();
      await expect(output).rejects.toThrow('aborted');
      await expect(pool.run('ignored', 'https://page.test/', controller.signal)).rejects.toThrow();
    } finally {
      await pool.close();
    }
  });
});
