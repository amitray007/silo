import { describe, expect, it } from 'vitest';
import { TransformPool } from './pool.js';

describe('transform worker pool', () => {
  it('transforms in real reusable worker threads', async () => {
    const pool = new TransformPool();
    try {
      const signal = new AbortController().signal;
      const results = await Promise.all([
        pool.run('<p>One<script>evil()</script></p>', 'https://page.test/', signal),
        pool.run('<img src="/photo.png">', 'https://other.test/', signal),
      ]);
      expect(results[0]).toContain('<p>One</p>');
      expect(results[0]).not.toContain('script');
      expect(results[1]).toContain('https://other.test/photo.png');
      expect(await pool.run('<p>Reused</p>', 'https://page.test/', signal)).toContain('Reused');
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
