import { describe, expect, it, vi } from 'vitest';
import { extractPageContent } from './reader-page.js';

describe('static Defuddle extraction', () => {
  it('keeps publisher scripts inert and does not fetch resources or async content', async () => {
    const network = vi.fn(() => {
      throw new Error('unexpected network');
    });
    vi.stubGlobal('fetch', network);
    try {
      const result = await extractPageContent(
        '<script>document.querySelector("p").textContent="executed"; fetch("https://evil.test/")</script><link rel="stylesheet" href="https://evil.test/style.css"><article><p>Original article.</p><img src="https://images.example.org/photo.jpg"></article>',
        'https://journal.example.org/article',
      );
      expect(result.text).toContain('Original article.');
      expect(result.text).not.toContain('executed');
      expect(result.reader?.contentImages).toEqual(['https://images.example.org/photo.jpg']);
      const shell = await extractPageContent(
        '<div id="root"></div>',
        'https://www.youtube.com/watch?v=jNQXAC9IVRw',
      );
      expect(shell.reader).toBeUndefined();
      expect(network).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
